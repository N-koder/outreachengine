import express, {type Request, type Response} from 'express';

import {type Lead, type SequenceStep, haltLeadOnReply} from './stateMachine.js';
import type { Mailbox } from './balancer.js';
import { runCampaignDispatch, type DispatcherConfig } from './dispatcher.js';

import { loadState, saveState, type DatabaseState , DEFAULT_STATE } from './storage.js';

const app = express();
app.use(express.json());

// serving frontend 
app.use(express.static("public"))

const PORT = 3000;
const PYTHON_VERIFIED_URL = 'http://127.0.0.1:8000/verify';

// In-Memory Database (simulating PostgreSQL for our campaign)
// let campaignLeads : Lead[] = [];

let db : DatabaseState = loadState();

// let mailboxPool : Mailbox[] = [
//     {
//         id : 'mb-1',
//         email : 'inbox1@outreach-pro.com',
//         dailylimit: 30,
//         sentToday : 5,
//         lastSentAt : null,
//         minCooldownSeconds : 2,
//         status : 'ACTIVE',
//     },

//     {
//         id :'mb-2',
//         email : 'inbox2@outreach-pro.com',
//         dailylimit : 30,
//         sentToday : 12,
//         lastSentAt : null,
//         minCooldownSeconds : 2,
//         status : 'ACTIVE',
//     }
// ];


const step1 : SequenceStep = {
    stepNumber : 1,
    delaySeconds : 0,
    subject : "Quick question regarding {company}",
    bodyTemplate : "Hi {firstName}, loved your recent work at {company}!",
};

const dispatcherConfig : DispatcherConfig = {
    minJitterSeconds : 1,
    maxJitterSeconds : 2,
};


// 1st endpoint : one-click Lead Import & Live verification Pipeline
app.post("/api/campaigns/import-and-verify" , async(req : Request , res : Response) => {
    const rawLeads : Array<{email : string ; firstName : string; company: string}> = req.body.leads;
    if(!rawLeads || !Array.isArray(rawLeads)){
        return res.status(400).json({error : "Invalid payload : 'leads' array is required."})
    }
    
    console.log(`\n📥 Received ${rawLeads.length} leads for import. Starting verification...`);

    const importedLeads : Lead[] = [];
    const rejectedLeads : Array<{email : string; reason : string}> = [];

    for(const raw of rawLeads){
        try{
            // 1. call our Python Verifier Microservice over HTTP
            const response = await fetch(
                PYTHON_VERIFIED_URL,
                {
                    method : "POST", 
                    headers : {"Content-Type" : "application/json"}, 
                    body : JSON.stringify({email : raw.email}),
            });

            if(!response.ok) throw new Error(`Verifier responded with status ${response.status}`);

            const report : any = await response.json();

            // 2. Only import if stricly VALID (pay-for-what-works model)
            if(report.status === 'VALID'){
                const newLead : Lead = {
                    id : `lead-${Date.now()}-${Math.random().toString(36).substring(2,7)}`,
                    email : raw.email,
                    firstName : raw.firstName,
                    company : raw.company,
                    status : 'PENDING',
                    currentStep : 0,
                    nextFollowUpAt : null,
                };
                importedLeads.push(newLead);
                console.log(` ✅ VERIFIED & QUEUED :${raw.email}`);

            }else{
                rejectedLeads.push({email : raw.email, reason : report.reason});
                console.log(`❌ REJECTED (${report.status}): ${raw.email} -> ${report.reason}`);
            }

        }catch(err: any){
            console.error(`⚠️ Verification failed for ${raw.email}: ${err.message}`);
            rejectedLeads.push({email : raw.email, reason : "Verification service unreachable"});
        }
    }


    // save verified leads into our campaign_data.json
    db.leads.push(...importedLeads);
    saveState(db);
    return res.status(200).json({
        message : "Lead import and verification complete.",
        summary : {
            totalReceived: rawLeads.length,
            verifiedAndImported : importedLeads.length,
            rejected : rejectedLeads.length,
        },
        verifiedLeads : importedLeads,
        rejectedLeads,
    });


});


// Launch Outreach Campaign

app.post('/api/campaigns/launch', async(_req : Request, res: Response) => {
    if(db.leads.length === 0){
        return res.status(400).json({error: "No leads in campaign pool. Import leads first."});
    }
    console.log(`\n Launching campaign with ${db.leads.length} leads in pool...`);

    // run dispatch in background
    runCampaignDispatch(db.leads, step1, db.mailboxes, dispatcherConfig, 86400).then((result) => {
        db.leads = result.updatedLeads;
        db.mailboxes = result.updateMailboxes;
        saveState(db);
        console.log("💾 Campaign state and mailbox quotas saved to disk.")

    })
    .catch((err) => console.error("Dispatcher error : ", err));

    return res.status(200).json({
        message : "Campaign dispatch triggered in background.",
        queuedLeadsCount : db.leads.length,
    });
});


// Inbound reply webhook (Unibox listener)
app.post("/api/webhooks/reply" , (req: Request, res: Response) => {
    const {email} = req.body;

    if(!email){
        return res.status(400).json({error : "'email' is required in webhook body."});
    }

    const targetLead = db.leads.find((i) => i.email.toLowerCase() === email.toLowerCase());

    if(!targetLead) return res.status(404).json({error : `Lead with email '${email}' not found. `});

    // halt the lead immediatly after using our state machine
    const haltedLead = haltLeadOnReply(targetLead);
    db.leads = db.leads.map((l) => (l.id === targetLead.id ? haltedLead : l));
    saveState(db); //save halt state to disk
     console.log(`\n🔔 [WEBHOOK] Prospect replied: ${email}. Outreach permanently HALTED.`);

     return res.status(200).json({
        message : `Outreach successfully halted for ${email}.`,
        lead : haltedLead,
     });
});

// campaign Health & status
app.get('/api/campaigns/status',(_req: Request, res: Response) => {
    return res.status(200).json({
        leads : db.leads,
        mailboxes : db.mailboxes
    });
});

// reset campaign
app.post("/api/campaigns/reset", (_req: Request, res: Response) => {
  db = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveState(db);
  console.log("🔄 Campaign reset to clean initial state.");
  return res.status(200).json({ message: "Campaign reset to initial state.", state: db });
});

app.post("/api/verify-direct" , async (req : Request, res: Response) => {
    try{
        const response = await fetch(PYTHON_VERIFIED_URL , {
            method : 'POST',
            headers : {"Content-Type" : "application/json"},
            body : JSON.stringify({email : req.body.email})
        });
        const data = await response.json();
        return res.status(response.status).json(data);
    }catch(err:any){
        return res.status(500).json({error : "Python verifier unreachable : " + err.message});
    }
}); 

app.listen(PORT , () => {
    console.log(`\n⚡ Outreach Orchestrator API running on http://localhost:${PORT}`);
    console.log(`🔗 Connected to Python Verifier at ${PYTHON_VERIFIED_URL}\n`);
    console.log(`💾 Persistent database loaded (${db.leads.length} leads saved)\n`);
})


app.post("/api/domain-health" , async (req : Request, res : Response) => {

    try{
        const response = await fetch("http://127.0.0.1:8000/domain-health" , {
            method : 'POST',
            headers : {'Content-Type' : 'application/json'},
            body : JSON.stringify({domain : req.body.domain}),

        });

        const data = response.json();
        return res.status(response.status).json(data);

    }catch(err : any){
        return res.status(500).json({error : "Domain health service unreachable: " + err.message});
    }

})