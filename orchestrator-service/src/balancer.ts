export type MailboxStatus = "ACTIVE" | "PAUSED" | "QUOTA_EXCEEDED";


export interface Mailbox{
    id: string;
    email : string;
    dailylimit : number;
    sentToday : number;
    lastSentAt : Date|null;
    minCooldownSeconds : number;
    status : "ACTIVE" | "PAUSED" | "QUOTA_EXCEEDED";
}


export function isMailboxReady(mailbox : Mailbox, now : Date = new Date()): boolean {
    if(mailbox.status !== 'ACTIVE'){
        return false;
    }

    if(mailbox.sentToday >= mailbox.dailylimit){
        return false;
    }

    if(!mailbox.lastSentAt){
        return true;
    }

    const elapsedSeconds = (now.getTime() - mailbox.lastSentAt.getTime()) / 1000;
    return elapsedSeconds >= mailbox.minCooldownSeconds;
}

export function pickNextAvailableMailbox(mailboxes:Mailbox[] , now : Date = new Date()) : Mailbox | null{
    const readyMailbox = mailboxes.filter((m) => isMailboxReady(m,now));

    if(readyMailbox.length === 0 ) return null;

    return readyMailbox.reduce((best, current) => {
        if(current.sentToday < best.sentToday) return current;
        if(current.sentToday > best.sentToday) return best;

        if(!current.lastSentAt) return current;
        if(!best.lastSentAt) return best;

        return current.lastSentAt.getTime() < best.lastSentAt.getTime() ? current : best;
    })
}

export function recordMailboxSens(mailbox: Mailbox, now: Date = new Date()) : Mailbox {
    const newSentToday = mailbox.sentToday + 1;
    return {
        ...mailbox,
        sentToday : newSentToday,
        lastSentAt : now,
        status : newSentToday >= mailbox.dailylimit ? 'QUOTA_EXCEEDED' : mailbox.status
    }
}


// --- SIMULATION TEST SUITE ---
// --- SIMULATION TEST SUITE ---
function runSimulation() {
  const now = new Date();

  const mockPool: Mailbox[] = [
    {
      id: "mb-1",
      email: "inbox1@outreach-domain1.com",
      dailylimit: 30,
      sentToday: 30, // EXHAUSTED (Hit quota)
      lastSentAt: new Date(now.getTime() - 1000 * 60 * 10),
      minCooldownSeconds: 300,
      status: "ACTIVE",
    },
    {
      id: "mb-2",
      email: "inbox2@outreach-domain2.com",
      dailylimit: 30,
      sentToday: 15,
      lastSentAt: new Date(now.getTime() - 1000 * 60 * 2), // 2 mins ago (Needs 5 mins cooldown)
      minCooldownSeconds: 300,
      status: "ACTIVE",
    },
    {
      id: "mb-3",
      email: "inbox3@outreach-domain3.com",
      dailylimit: 30,
      sentToday: 5,
      lastSentAt: new Date(now.getTime() - 1000 * 60 * 20), // 20 mins ago (READY!)
      minCooldownSeconds: 300,
      status: "ACTIVE",
    },
  ];

  console.log("--- EVALUATING MAILBOX POOL ---");
  const selected = pickNextAvailableMailbox(mockPool, now);

  if (selected) {
    console.log(`✅ Selected Mailbox: ${selected.email} (Sent today: ${selected.sentToday}/${selected.dailylimit})`);
  } else {
    console.log("❌ No mailboxes currently available");
  }
}

// Execute the simulation
// runSimulation();