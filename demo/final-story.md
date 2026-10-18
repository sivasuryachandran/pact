# Final story — 2:45 video storyboard

## 0:00–0:20 — The trust boundary

Open the PACT web experience and say: “PACT is a simulated Alexa+ add-on.
AI proposes, the household confirms, code decides, and the receipt remembers.”
Point at the glowing voice orb, its state legend, the three simulated surfaces,
and the local PACT tool trace.

## 0:20–0:45 — A rule in household language

Type or say: “Ask me before booking anything over $100.” Show the Bedrock
candidate, read-back, synthetic replay preview, and `confirmed: false`. Click
the adult confirmation control. The rulebook updates only after confirmation.

## 0:45–1:35 — Run Maya Demo

Click **Run Maya Demo**. The four synchronized turns are:

1. Maya: “Plan Maya’s birthday under $150.” A SQLite-backed sandbox plan is created.
2. Maya: “Book Funzone.” VenueBook submits a $120 booking to PACT and receives `ask`.
3. Dad: “Approve.” Dad sees the exact merchant, beneficiary, amount, and request hash. The approved booking is held against the plan; it is not silently executed.
4. Maya: “Add the decorations.” GiftCart submits $40 and receives `deny` because $120 + $40 would be $160, over the $150 plan.

## 1:35–2:00 — Show the surfaces

Show the living-room summary, Dad’s private approval details, and Maya’s
simple explanation. Use “Try private routing” to show that a shared surface
receives only “That’s private.”

## 2:00–2:25 — Show enforcement

Use the manual add-on check. Point to `check_action → approval if required →
execute exact token`. Attempting execution without approval, with a forged
token, after changing the price, or by replaying a token produces a rejected
receipt. The mock executor never performs a denied or unapproved action.

## 2:25–2:45 — Close with evidence

Open the receipt timeline and say: “This is not a real purchase, booking,
device, or Alexa+ integration. It is a working gateway pattern over mock
add-ons.” Finish with the MCP endpoint and the evidence: 23 local tests, one
legitimate allow, one approval-required case, one legitimate deny, 240
adversarial attempts, and zero unauthorized executions.
