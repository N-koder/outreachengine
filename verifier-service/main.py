from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

from verifier import verify_email, VerificationReport, check_domain_dns_health

app = FastAPI(
    title = "OutreachEngine - Real-Time Deliverability Verifier",
    description = 'High-performance SMTP socket & DNS verification microservice',
    version = "1.0.0"
)


# request schema for single email
class VerifyRequest(BaseModel):
    email : EmailStr

class BatchVerifyRequest(BaseModel):
    emails : list[str]

class DomainHealthRequest(BaseModel):
    domain : str


@app.get('/')
def health_check():
    return {'status' : 'ok' , 'service' : 'email-verifier-microservice'}

@app.post('/verify')
def verify_single_email(payload : VerifyRequest):
    report = verify_email(payload.email)
    return report


@app.post('/verify/post')
def verify_batch_emails(payload : BatchVerifyRequest):
    if len(payload.emails) > 100:
        raise HTTPException(
            status_code=400,
            detail="Batch limit exceeded. Maximum 100 emails per batch request."
        )
    
    results = [verify_email(email) for email in payload.emails]


    # calculate summary metrics 
    valid_count = sum(1 for r in results if r['status'] == "VALID")
    invalid_count = sum(1 for r in results if r['status'] == "INVALID")
    catch_all_count = sum(1 for r in results if r['status'] == 'CATCH_ALL')


    return {
        "total" : len(results),
        "valid" : valid_count,
        "invalid" : invalid_count,
        "catch_all" : catch_all_count,
        "results" : results
    }


@app.post("/domain-health")
def check_domain_health(payload : DomainHealthRequest):
    # analyzes SPF and DMARC compilance for sender deliverability

    return check_domain_dns_health(payload.domain)