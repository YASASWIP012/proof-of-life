// A synthetic RTI reply for the drill. Every name, number and place in it is invented.
export function syntheticRtiReply(): { name: string; type: string; text: string } {
  const ref = `SYN/PIO/${Math.floor(1000 + Math.random() * 9000)}/2026`;
  return {
    name: "rti-reply-road-works-SYNTHETIC.txt",
    type: "text/plain",
    text: `SYNTHETIC TEST DOCUMENT. NOT A REAL RTI REPLY. ALL DETAILS ARE INVENTED.

Office of the Public Information Officer
Rural Works Division, Fictional District

Ref: ${ref}
Subject: Reply under Section 7(1) of the RTI Act, 2005

1. Road works sanctioned for Village A-17 in 2024-25:
   Work order WO-2291, 4.2 km, sanctioned amount Rs 1,84,00,000.
2. Measurement book entries: 4.2 km recorded as completed on 12-03-2025.
3. Completion certificate signed by the Assistant Engineer (designation only).
4. Field note by the applicant: about 1.1 km of road exists on the ground.

The applicant may appeal to the First Appellate Authority within 30 days.
`,
  };
}
