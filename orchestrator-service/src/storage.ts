import path from "path";
import fs from 'fs';
import type { Lead } from "./stateMachine.js";
import type { Mailbox } from "./balancer.js";

const DATA_FILE = path.join(process.cwd(), 'campaign_data.json');

export interface DatabaseState {
    leads : Lead[];
    mailboxes : Mailbox[];
}


export const DEFAULT_STATE : DatabaseState = {
    leads : [],
    mailboxes : [
        {
            id : "mb-1",
            email : "inbox@outreach-pro.com",
            dailylimit : 30,
            sentToday : 5,
            lastSentAt : null,
            minCooldownSeconds : 2,
            status : "ACTIVE",
        },
        {
            id : 'mb-2',
            email : 'inbox2@outreach-pro.com',
            dailylimit : 30,
            sentToday : 12,
            lastSentAt : null,
            minCooldownSeconds : 2,
            status : "ACTIVE"
        },

        {
            id : 'mb-3',
            email : 'inbox@outreach-pro.com',
            dailylimit : 30,
            sentToday : 2,
            lastSentAt : null,
            minCooldownSeconds : 2,
            status : 'ACTIVE'
        }
    ]
};



export function saveState(state : DatabaseState) : void {
    try{
        fs.writeFileSync(DATA_FILE, JSON.stringify(state,null,2), 'utf-8');
    }catch(err){
        console.error('Failed to save database file : ', err);
    }
}


// loads database state from disk. Creates default data if  file doesn't exist

export function loadState() : DatabaseState{
    try{
        if(!fs.existsSync(DATA_FILE)){
            saveState(DEFAULT_STATE);
            return DEFAULT_STATE;
        }
        const raw = fs.readFileSync(DATA_FILE , 'utf-8');
        return JSON.parse(raw);

    }catch(err){
        console.error("Failed to send database file, using defaults: ", err);
        return DEFAULT_STATE;
    }
}