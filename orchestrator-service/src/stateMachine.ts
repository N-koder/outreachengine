export type LeadStatus = "PENDING" | "STEP_1_SENT" | "STEP_2_SENT" | "COMPLETED" | "REPLIED" | "BOUNCED";

export const TERMINAL_STATUES: ReadonlySet<LeadStatus> = new Set(["COMPLETED", "REPLIED", "BOUNCED"]);

export interface Lead {
    id: string;
    email: string;
    firstName: string;
    company: string;
    status: LeadStatus;
    currentStep: number; // 0 = none sent yet, 1= step 1 sent, etc.
    nextFollowUpAt: Date | null; // Timestamp when the next step is unlocked
}

export interface SequenceStep {
    stepNumber: number;
    delaySeconds: number; //wait time after previous step before this one sends
    subject: string;
    bodyTemplate: string;
}

export interface ValidationCheckResult {
    allowed: boolean;
    reason: string;
}


// replace variables in email template 
export function interpolateTemplate(template: string, lead: Lead): string {
    return template.replace(/{firstName}/g, lead.firstName).replace(/{company}/g, lead.company).replace(/{email}/g, lead.email);
}


export function canSendNextStep(lead: Lead, step: SequenceStep, now: Date = new Date()): ValidationCheckResult {

    if (TERMINAL_STATUES.has(lead.status)) {
        return {
            allowed: false,
            reason: `Outreach permanently halted because lead status is '${lead.status}'`
        };
    }

    // strict squencial order : cannot skip steps
    const expectedNextStep = lead.currentStep + 1;
    if (step.stepNumber !== expectedNextStep) {
        return {
            allowed: false,
            reason: `Step mismatch : lead is at step ${lead.currentStep} , cannot execute step ${step.stepNumber},`,
        };
    }

    if (lead.nextFollowUpAt && now.getTime() < lead.nextFollowUpAt.getTime()) {
        const remainingSeconds = Math.ceil((lead.nextFollowUpAt.getTime() - now.getTime()) / 1000);
        return {
            allowed: false,
            reason: `Delay lock active : next step unlocked in ${remainingSeconds} seconds.`,
        };
    }

    return {
        allowed: true,
        reason: 'Ready to send.'
    }

}

// update lead state after dispatching a step sucessfully

export function transitionAfterSend(lead: Lead, step: SequenceStep, nextStepDelaySeconds: number | null = null, now: Date = new Date()): Lead {
    const isFinalStep = nextStepDelaySeconds === null;
    const newStatus: LeadStatus = isFinalStep ? "COMPLETED" : (step.stepNumber === 1 ? "STEP_1_SENT" : "STEP_2_SENT");

    const nextUnlockTime = nextStepDelaySeconds ? new Date(now.getTime() + nextStepDelaySeconds * 1000) : null;

    return {
        ...lead,
        currentStep: step.stepNumber,
        status: newStatus,
        nextFollowUpAt: nextUnlockTime
    }
}


export function haltLeadOnReply(lead: Lead): Lead {
    return {
        ...lead,
        status: "REPLIED",
        nextFollowUpAt: null
    }
}

export function haltLeadOnBounce(lead: Lead): Lead {
    return {
        ...lead,
        status: "BOUNCED",
        nextFollowUpAt: null
    }
}






function RunSimulation() {
    const startTime = new Date();

    let lead: Lead = {
        id: 'lead-101',
        email: 'sarah@stripe.com',
        firstName: 'Sarah',
        company: 'Stripe',
        status: 'PENDING',
        currentStep: 0,
        nextFollowUpAt: null
    };

    const step1: SequenceStep = {
        stepNumber: 1,
        delaySeconds: 0,
        subject: "Quick question regarding {company}",
        bodyTemplate: "Hi {firstName}, loved your recent product launch at {company}!",
    };

    const step2: SequenceStep = {
        stepNumber: 2,
        delaySeconds: 86400,
        subject: "Re : Quick question regarding {company}",
        bodyTemplate: "Hey {firstName}, following up on my previous note."
    };



    console.log("--- 1. TESTING INITIAL SEND ---");
    const check1 = canSendNextStep(lead, step1, startTime);
    console.log(`Can send Step 1? ${check1.allowed} (${check1.reason})`);
    // Send Step 1, with a 24-hour delay before Step 2
    lead = transitionAfterSend(lead, step1, step2.delaySeconds, startTime);
    console.log(`Lead updated: Step ${lead.currentStep}, Status: ${lead.status}`);
    console.log(`Next follow-up unlocked at: ${lead.nextFollowUpAt?.toISOString()}`);

    console.log("\n--- 2. TRYING TO SEND STEP 2 IMMEDIATELY (SHOULD BE BLOCKED) ---");
    const check2Early = canSendNextStep(lead, step2, startTime);
    console.log(`Can send Step 2 early? ${check2Early.allowed} -> ${check2Early.reason}`);

    console.log("\n--- 3. SIMULATING PROSPECT REPLY (WEBHOOK EVENT) ---");
    lead = haltLeadOnReply(lead);
    console.log(`Lead replied! New status: ${lead.status}`);

    console.log("\n--- 4. TRYING TO SEND STEP 2 AFTER REPLY (MUST BE PERMANENTLY HALTED) ---");
    // Fast forward 2 days in the future
    const futureTime = new Date(startTime.getTime() + 1000 * 60 * 60 * 48);
    const check2AfterReply = canSendNextStep(lead, step2, futureTime);
    console.log(`Can send Step 2 after reply? ${check2AfterReply.allowed} -> ${check2AfterReply.reason}`);
}

// RunSimulation();