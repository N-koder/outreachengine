import dns.resolver


resolver = dns.resolver.Resolver()
resolver.timeout = 2.0
resolver.lifetime = 3.0 

def get_mx_record(domain : str) -> list[str]:
    domain = domain.strip().lower()

    try:
        answers = resolver.resolve(domain , 'MX')
        sorted_answers = sorted(answers , key=lambda record : record.preference)
        # return [str(sorted_answers).strip('.') for records in sorted_answers] #entire list of Python DNS objects 
        return [str(r.exchange).rstrip('.') for r in sorted_answers] #Extract ONLY the exchange hostname as a clean string!

    except dns.resolver.NXDOMAIN:
        return []

    except (dns.resolver.NoAnswer , dns.resolver.NoNameservers):
        return []

    except dns.exception.Timeout:
        return []



import smtplib
import socket
from typing import TypedDict, Optional


class SMTPcheckresult(TypedDict) : 
    deliverable : Optional[bool]
    status : str
    code : int
    message : str



def verify_smtp_mailbox(mx_host : str, target_email : str, sender_domain : str = 'check.com') -> SMTPcheckresult:

    sender_email = f'verify@{sender_domain}'
    try : 
        # connect with strict 5 sec timeout
        server = smtplib.SMTP(timeout=5.0)

        # connect to port 25
        code, msg = server.connect(mx_host)
        if(code != 220):
            return {
                "deliverable" : None,
                "code" : code,
                "status" : "CONNECTION_REJECTED",
                "message" : f"Server rejected initial connection : {msg.decode('utf-8' , errors = 'ignore')}" 
            }

        # Identify ourselves (EHLO, fallback to HELO)
        try:
            server.ehlo(sender_domain)
        except smtplib.SMTPException:
            server.helo(sender_domain)

        # Inform server who is initiating the session
        code, _ = server.mail(sender_email)
        if(code != 250):
            return {
                "deliverable" : None,
                "status" : "MAIL_FROM_REJECTED",
                "code" : code,
                "message" : "Mail server rejected  sender address"
             }

        # The probe : ask if the recipient exists
        code , raw_msg = server.rcpt(target_email)
        msg_str = raw_msg.decode('utf-8' , errors='ignore') if isinstance(raw_msg,bytes) else str(raw_msg)

        
        if(code == 250):
            return {
                "deliverable" : True,
                "status" : "VALID",
                "code" : code,
                "message" : "Recipient address accepted"
            }

        elif(500 <= code < 600):
            return {
                "deliverable"  : False,
                "status" : "INVALID",
                "code" : code,
                "message" : f"Recipient rejected : {msg_str}"
            }

        elif(400 <= code < 500):
            return{
                "deliverable" : None,
                "status" : "GREYLISTED",
                "code" : code,
                "message" : f"Temporary defferal/greylisting : {msg_str}"
             }
        else : 
            return{
                "deliverable" : None,
                "status" : "UNKNOWN",
                "code" : code,
                "message" : msg_str
            }
        
    except(socket.timeout , TimeoutError):
        return{
            "deliverable"  : True,
            "status" : "BLOCKED_OR_TIMEOUT",
            "code" : 0,
            "message" : "Connection timed out (PORT 25 may be blocked by your ISP or firewall)"
        }

    except(smtplib.SMTPServerDisconnected , ConnectionRefusedError, OSError) as e:
        return {
            "deliverable" : None,
            "status" : "BLOCKED_OR_TIMEOUT",
            "code" : 0,
            "message" : f"Network/Socket error : {str(e)}"
        }

    finally:
        if server:
            try : 
                server.quit()
            except Exception:
                server.close()


import re
import uuid

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
DOMAIN_CATCH_ALL_CACHE : dict[str,bool] = {}


class VerificationReport(TypedDict):
    email : str
    domain : str
    status : str # valid , invalid, catch_all, no_mx, syntax_error, timeout
    deliverable : Optional[bool]
    is_catch_all : bool
    mx_host: Optional[str]
    smtp_code : int
    reason : str

def check_catch_all(mx_host:str, domain:str)->bool:


    if domain in DOMAIN_CATCH_ALL_CACHE:
        return DOMAIN_CATCH_ALL_CACHE[domain]

    random_str = uuid.uuid4().hex[:12]
    fake_email = f"catchall_proble_{random_str}@{domain}"

    result = verify_smtp_mailbox(mx_host, fake_email)

    is_catch_all = (result.get("deliverable") is True)



    DOMAIN_CATCH_ALL_CACHE[domain] = is_catch_all
    return is_catch_all


def verify_email(email:str)->VerificationReport:
    # 1. Syntax and sanitization
    cleaned_email = email.strip().lower()
    if not EMAIL_REGEX.match(cleaned_email):
        return{
            "email" : cleaned_email,
            "domain" : "",
            "status" : "SYNTAX_ERROR",
            "deliverable" : False,
            "is_catch_all" : False,
            "mx_host" : None,
            "smtp_code" : 0,
            "reason" : "Email format violates RFC syntax"
        }


    # 2. MX DNS Resolution    
    domain = cleaned_email.split("@")[1]

    mx_hosts = get_mx_record(domain)
    if not mx_hosts:
        return {
            "email" : cleaned_email,
            "domain" : domain,
            "status" : "NO_MX",
            "deliverable" : False,
            "is_catch_all" : False,
            "mx_host" : None,
            "smtp_code" : 0,
            "reason" : f"No active mail exchange (MX) servers found for domains '{domain}' ."
        }


    # 3. Direct SMTP handshake Probe
    primary_mx = mx_hosts[0]
    smtp_result = verify_smtp_mailbox(primary_mx,cleaned_email)

    if smtp_result['deliverable'] is False:
        return{
            "email" : cleaned_email,
            "domain" : domain,
            "status" : "INVALID",
            "deliverable" : False,
            "is_catch_all" : False,
            "mx_host" : primary_mx,
            "smtp_code" : smtp_result["code"],
            "reason" : smtp_result["message"]
        }

    if smtp_result["deliverable"] is None:
        return{
            "email" : cleaned_email,
            "domain" : domain,
            "status" : smtp_result["status"],
            "deliverable" : None,
            "is_catch_all" : False,
            "mx_host" : primary_mx,
            "smtp_code" : smtp_result["code"],
            "reason" : smtp_result["message"]
        }


    # 4. Catch-all Detection
    is_catch_all = check_catch_all(primary_mx , domain)
    if is_catch_all:
        return {
            "email" : cleaned_email,
            "domain" : domain,
            "status" : "CATCH_ALL",
            "deliverable" : True,
            "is_catch_all" : True,
            "mx_host" : primary_mx,
            "smtp_code" : smtp_result["code"],
            "reason" : "Server accepted address, but domain is catch-all(accepts all emails)"
        }

    # If we reached here : Target email exists AND domain rejects fake emails
    return {
        "email" : cleaned_email,
        "domain" : domain,
        "status" : "VALID",
        "deliverable" :True,
        "is_catch_all" : False,
        "mx_host" : primary_mx,
        "smtp_code" : smtp_result["code"],
        "reason" : "Email mailbox exists and domain is strictly verified"
    }




if __name__ == "__main__":
    test_domains = ["google.com" , "github.com" , "thisisafakedomain12345.xyz"]

    for d in test_domains:
        mx_servers = get_mx_record(d)
        print(f"Domain : {d} -> primary MX :  {mx_servers[0] if mx_servers else 'None'}")

    test_email = "n8168397@gmail.com"
    domain = test_email.split("@")[1]

    print(f"\n--- checking : {test_email} ---")
    mx_hosts = get_mx_record(domain)   

    if not mx_hosts:
        print("NO MX servers found for domains!")

    else:
        primary_mx = mx_hosts[0]
        print(f"Connecting to primary MX: {primary_mx}...")

        result = verify_smtp_mailbox(primary_mx , test_email)
        print("Result:")
        for key, value in result.items():
            print(f"{key} : {value}")


    test_emails = [
        "n8168397@gmail.com",                  # Real address (should be VALID)
        "fake_random_user_998822@gmail.com",   # Fake address (should be INVALID, 550)
        "bad-format-email.com",                 # Bad syntax (should be SYNTAX_ERROR)
        "test@fake982347nonexistent.com"
    ]

    print("\n -------------- STARTING VERIFICATION BATCH-------------\n")
    for email in test_emails:
        report = verify_email(email)
        print(f"Email : {report['email']}")
        print(f"status : {report['status']} (Deliverable : {report['deliverable']})")
        print(f"CatchAll : {report['is_catch_all']}")
        print(f"Reason : {report['reason']}")
        print("-"*60)