// #3111 leg 2b synthetic focus SSOT stub (the same shape the parity/size smokes stub): one focus
// 'Cost' with one live row (9803) whose step facts must come from the referee's WORK-pool row.
process.stdout.write(JSON.stringify([
  { name: 'Cost', goal: 'fixture goal cost', total: 2, done: 1, open: 1, in_progress: 1, rows: [
    { n: 1, id: 9803, subject: 'DEMO executor running although a review row landed', status: 'in_progress', blockedBy: [], done: false },
    { n: 2, id: 9801, subject: 'DEMO merged leg waits for its next leg', status: 'pending', blockedBy: [], done: true } ] },
]));
