import { pickNextAvailableMailbox, recordMailboxSens, type Mailbox } from "./balancer.js";
import { canSendNextStep, interpolateTemplate, transitionAfterSend, type Lead, type SequenceStep } from "./stateMachine.js";

export interface DispatcherConfig {
    minJitterSeconds: number; // e.g 2 seconds (for simulation) or 180s(in production)
    maxJitterSeconds: number; // e.g 5 seconds (for simulation) or 360s(in production)
}


/**
 * Personalization Engine
 * Generates a contextual, personalized opening
 * tailored specifically to the prospect's company and role
 */


export function generateIcebreaker(lead : Lead): string {
    const companyClean = lead.company.trim().toLowerCase();

    if(companyClean.includes('antigravity')){
        return `Loved seeing Antigravity's recent work on developer aganet workflows-super clean execution!`
    }
    else if(companyClean.includes('stripe')){
        return `Huge fan of Stripe's recent developer push into autonomus billing integrations!`;
    }
    else if(companyClean.includes('notion')){
        return `Really impressed by how Notion is innovating modular AI workspaces!`
    }
    else if(companyClean.includes('openai')){
        return `Fascinating to watch your team's rapid iteration on frontier reasoning models!`;
    }


    return `Really impressed by the momentum your engineering team is driving at ${lead.company}`;
}







// Generates a randomized human delay (jitter) between  min and max seconds

export function calculateJitterDelay(minSeconds: number, maxSeconds: number): number {
    const minMs = minSeconds * 1000;
    const maxMs = maxSeconds * 1000;

    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// Helper to pause execution asynchronously (simulating real time passing)

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


// The core Dispatcher : Processes a queue of leads across a pool of mailboxes

export async function runCampaignDispatch(
    leads: Lead[], 
    steps: SequenceStep, 
    mailboxes: Mailbox[], 
    config: DispatcherConfig, 
    nextStepDelaySeconds: number | null = null
): Promise<{ updatedLeads: Lead[]; updateMailboxes: Mailbox[] }> {

    console.log(`\n STARTING CAMPAIGN DISPATCH FOR STEP ${steps.stepNumber} (${steps.subject})`);
    console.log(`Leads in queue : ${leads.length} | Available mailboxes : ${mailboxes.length}\n`);

    let currentMailboxes = [...mailboxes];
    const processedLeads: Lead[] = [];

    for (let i = 0; i < leads.length; i++) {
        let lead = leads[i];
        if(!lead) continue; // <-- Narrows 'lead' from (Lead | undefined) to Lead! Type guard

        const now = new Date();
        console.log(`[Queue position ${i + 1}/${leads.length}] Checking lead : ${lead?.email}...`);


        // check eligibilty;
        const eligibilty = canSendNextStep(lead, steps, now);
        if(!eligibilty.allowed) {
            console.log(`SKIPPING : ${eligibilty.reason}`);
            processedLeads.push(lead);
            continue;
        }


        // check Mailbox balancer
        const selectedMailbox = pickNextAvailableMailbox(currentMailboxes, now);
        if(!selectedMailbox) {
            console.log(`PAUSING: No mailboxes currently available!`);
            processedLeads.push(lead);
            continue;
        }

        //Jitter Delay
        const delayMs = calculateJitterDelay(config.minJitterSeconds, config.maxJitterSeconds);
        console.log(`Jitter delay: waiting  ${(delayMs/1000).toFixed(1)}s...`);
        await sleep(delayMs);

        //Dispatch Email 
        // const personalizedSubject = interpolateTemplate(steps.subject,lead);
        // console.log(`  📤 DISPATCHED:`);
        // console.log(`     From: ${selectedMailbox.email}`);
        // console.log(`     To  : ${lead.email}`);
        // console.log(`     Subj: "${personalizedSubject}"`);

        // Dispatch Email with AI personalization hook
        const icebreaker = generateIcebreaker(lead);
        const personalizedSubject = interpolateTemplate(steps.subject,lead);
        const rawBody = `${icebreaker}\n\n${steps.bodyTemplate}`;
        const personalizedBody = interpolateTemplate(rawBody,lead);

        console.log(`  📤 DISPATCHED:`);
        console.log(`     From: ${selectedMailbox.email}`);
        console.log(`     To  : ${lead.email}`);
        console.log(`     Subj: "${personalizedSubject}"`);
        console.log(`     Hook: "${icebreaker}"`);
        


        

        //Update Mailbox
        currentMailboxes = currentMailboxes.map((mb) => mb.id === selectedMailbox.id ? recordMailboxSens(mb, new Date()) : mb);


        //Update Lead State
        lead = transitionAfterSend(lead, steps, nextStepDelaySeconds, new Date());
        console.log(` State updated :  Lead is now ${lead.status}\n`);

        processedLeads.push(lead);
    }


    console.log("CAMPAIGN DISPATCH COMPLETED.");
    return {updatedLeads : processedLeads, updateMailboxes : currentMailboxes};
}



// TEST 

async function runSimulation(){
    // pool of sender accounts (smartlead style)
    const mailboxes : Mailbox[] = [
        {
            id : 'mb-1',
            email : 'inbox1@outreach-pro.com',
            dailylimit: 30,
            sentToday : 29, // can send only 1 email more!
            lastSentAt : null,
            minCooldownSeconds : 2,
            status: 'ACTIVE',

        },

        {
            id : 'mb-2',
            email : 'inbox2@outreach-pro.com',
            dailylimit : 30,
            sentToday : 10,
            lastSentAt : null,
            minCooldownSeconds : 2,
            status : 'ACTIVE',
        },

    ];


    //List of leads (verified by our python service!)
    const leads : Lead[] = [
        {
            id : 'l-1',
            email : "alex@stripe.com",
            firstName : 'Alex',
            company : 'Stripe',
            status : 'PENDING',
            currentStep : 0,
            nextFollowUpAt : null,
        },

        {
            id : 'l-2',
            email : "sarah@openai.com",
            firstName : 'Sarah',
            company : 'OpenAI',
            status : 'REPLIED', // Already replied must be skipped
            currentStep : 1,
            nextFollowUpAt : null,
        },


        {
            id : 'l-3',
            email : 'david@notion.so',
            firstName : 'David',
            company : 'Notion',
            status : 'PENDING',
            currentStep : 0,
            nextFollowUpAt : null,
        },
    ];


    const step1 : SequenceStep = {
        stepNumber : 1,
        delaySeconds : 0,
        subject : 'Quick idea for {company}',
        bodyTemplate : 'Hey {firstName} , noticed what you are building at {company}!',
    };

    const config : DispatcherConfig = {
        minJitterSeconds : 1,
        maxJitterSeconds : 3,
    };

    await runCampaignDispatch(leads, step1, mailboxes, config, 86400);
}

// runSimulation();