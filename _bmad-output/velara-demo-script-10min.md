# Velara — 10-Minute Demo Script

**Audience:** Vitalief / client stakeholders (non-technical)
**Presenter view only** — internal/admin login (ma_tech). No client-portal login in this version.
**Before you start:** confirm you can log in with `hozefa.tankiwala@matechnologies.net` — this demo needs internet + a live Cognito session, so test it within an hour of presenting, not the night before.

---

## 0. Cold open (30 sec) — before touching the screen

> "Vitalief's consultants do the same handful of things over and over on every engagement — pulling inclusion/exclusion criteria out of a protocol, calculating visit budgets, extracting procedures. Velara turns that expertise into reusable, governed 'skills' that run on demand, with a full audit trail and the same quality bar every time. I'm going to show you the whole lifecycle in the next ten minutes: what a skill looks like, how we make sure it's safe to hand to a client, and what it looks like when someone actually runs it."

Open the browser to the internal app and log in live.

---

## 1. The Engagements tree (60 sec)

Land on the **Engagements** screen after login.

> "This is where everything starts — the same hierarchy Vitalief already thinks in: Client, Project, Study, Location. This isn't a demo hierarchy, this is a real client engagement we've set up: **Beth Israel Lahey Health**, their **Oncology Network Setup** project, the **ONC-204 Phase I** study, running out of Mass General Hospital in Arlington."

Click down: Client → Project → Study.

> "Everything a consultant does — every skill they run, every file they touch — gets attached to this exact context. That context is what drives access control and what shows up later in the audit trail."

---

## 2. Skill Registry — the library of expertise (90 sec)

Navigate to **Skill Registry**.

> "This is the library. Every skill Vitalief has built lives here, and each one carries a lifecycle state — not everything in here is ready to hand to a client."

Point out the states across the real seeded skills:

- **Protocol Extractor Raw Skill** — *draft* — "still being built, not runnable yet."
- **Velara Protocol Procedure Extractor** — *internal_ready* — "works, certified for internal use, but not yet cleared for client eyes."
- **Extract Inclusion and Exclusion Criteria** — *client_ready* — "this one's been through our full two-key certification and is approved to hand directly to a client."
- **Protocol Visit Budget Calculator** — *internal_ready*, code-based — "a deterministic calculator, no AI involved — shows we're not an 'AI hammer looking for nails,' we use the right tool per skill."

> "That state machine — draft → internal-ready → client-ready — is enforced by the platform, not a spreadsheet. A skill can't jump to client-ready without two people signing off."

Click into **Extract Inclusion and Exclusion Criteria** → show the **Certification** tab/history.

> "Here's the proof: a technical certification from MA Technologies confirming it runs correctly on real and adversarial inputs, and a separate methodological certification confirming the output actually meets Vitalief's quality bar. Both are permanent, immutable records — once signed, they can't be edited or deleted, only added to."

---

## 3. Run it live (2.5 min) — the centerpiece

Stay on **Extract Inclusion and Exclusion Criteria** → click **Run**.

> "Let's actually run one. This is the skill we just certified — I'm going to invoke it in the context of that same study we looked at a minute ago."

Confirm the context is pre-filled (Client/Project/Study), kick off the run.

> "Behind the scenes this is queued to a job worker — so if this were a document that takes two minutes to process, you wouldn't be sitting here watching a spinner. You'd get a job ID back immediately and come back to it."

While it runs (or once it completes):

> "When it finishes, we get a real output file — a properly formatted document, not a raw text dump — ready to hand to the client as-is."

Open the resulting PDF/output.

> "And this exact run — who ran it, when, what study it was tied to, what the outcome was — is now a permanent line in our audit log. Nothing about this platform is 'trust me, it happened.' Everything is provable."

---

## 4. Audit Log & Usage Analytics (90 sec)

Navigate to **Audit Log**.

> "Every single action on this platform lands here — not just runs. Certifications, access grants, document uploads, even when someone reads a sensitive file. This is append-only — nobody, including us, can edit or delete history. That matters a lot in a regulated, clinical-research context."

Filter or scroll to show variety of event types (invocation.success, admin.certification, admin.lifecycle_transition).

Navigate to **Usage & Value**.

> "And this rolls all of that up into something a program lead actually wants to look at — how much is getting used, success rates, which skills are earning their keep, and roughly how much consultant time this is saving versus doing it by hand."

---

## 5. The AI Integration Assistant — the "wow" moment (2 min)

> "Now here's the part that took real engineering to get right, and I think it's the most impressive thing to show. When Vitalief or a client brings us an existing piece of code they've already written — some analysis script — normally that means an engineer manually rewrites it to fit our platform's contract. That's slow and it's a bottleneck."

If you have a pre-staged non-conforming bundle ready to upload — **use it now**; don't improvise a zip file live.

> "Watch what happens when I upload a script that *doesn't* match our expected format."

Upload the bundle → the platform detects it doesn't conform → offers **AI-adapt this skill**.

> "Instead of just failing with an error, the platform recognizes the shape mismatch and offers to have Claude — Anthropic's AI — write a small adapter that bridges the client's code to our contract."

Click through, show the proposed adapter + manifest for human review.

> "Critically — the AI never touches the client's actual logic. It only writes a thin wrapper around it, and everything it proposes comes back to a human for review and approval before anything is registered. We get the speed of AI assistance without giving up control over what actually runs."

Approve → skill registers.

> "That took thirty seconds. Before this existed, that was hours of an engineer's time per skill."

---

## 6. Close (30 sec)

Return to Engagements or Skill Registry as a clean landing shot.

> "So in ten minutes: a real client hierarchy, a governed skill library with enforced certification, a live run producing a real deliverable, a complete and tamper-proof audit trail, and an AI assistant that speeds up onboarding new skills without ever compromising oversight. This is a platform built for a regulated industry — fast where it can be, careful where it has to be."

---

## Presenter notes — things to protect

- **Login is real Cognito** — no offline fallback. Test within an hour of presenting.
- **Only `Extract Inclusion and Exclusion Criteria` is `client_ready`** — it's your one clean "run a skill" candidate. Don't try to run the draft or internal-only ones as the centerpiece.
- **Have the non-conforming bundle for Section 5 staged and ready as a file** before you start — don't build it live.
- **Don't open worker logs on the shared screen** — there's a harmless but alarming-looking recurring CloudWatch warning in there.
- **Don't demo location-dependent fan-out** — no real fan-out runs exist in the seed data and only one location is seeded; it would need setup this script doesn't assume.
- **Don't run `docker compose down -v` or rebuild anything before presenting** — there's no seed script; the current demo data is real usage history and can't be regenerated with one command.
- Keep an eye on time in Section 3 (the run) — if the skill takes longer than expected live, have a already-completed run of the same skill ready to click into as a fallback so you're not narrating a spinner.
