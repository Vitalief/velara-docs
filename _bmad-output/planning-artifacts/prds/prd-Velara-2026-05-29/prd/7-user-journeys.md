# 7. User Journeys

## UJ-1: Consultant invokes a Study-scoped, location-dependent skill

*Sarah, a Vitalief consultant on the BILH Engagement, needs to generate a site readiness report for each participating clinical site in Study 004.*

1. Sarah logs into the platform and navigates to the BILH Engagement → Protocol Amendment Study.
2. She selects the "Site Readiness Report" skill from the Study's skill list.
3. The platform surfaces a location selector — the skill is marked location-dependent.
4. Sarah chooses "Run for all locations." The platform confirms: 6 locations, 6 parallel invocations.
5. She uploads the site monitoring visit report (PDF) for context.
6. The platform fans out 6 executions, one per site, each receiving the uploaded document and the relevant site metadata.
7. Results return as 6 DOCX files, each branded with Vitalief headers, named by site. A summary table is included in the response.
8. The full run is logged as one parent invocation with 6 child records, each recording site, timing, and outcome.

## UJ-2: Client invokes a client-facing skill

*The BILH engagement lead has granted their clinical ops director access to the "Protocol Deviation Summary" skill.*

1. The clinical ops director logs into the client portal (web, Phase 2) or calls the invocation API.
2. She sees the skill name and description. She uploads a deviation log spreadsheet (XLSX).
3. She submits the invocation. The platform resolves the skill server-side, executes, and returns a formatted PDF summary.
4. At no point does the API or UI expose the prompt template, code, reference files, or methodology behind the output.
5. The invocation is logged under her user, the client, and the engagement.

## UJ-3: MA Tech certifies a skill for client-ready status

*A newly authored "Enrollment Projection" skill has been submitted for certification.*

1. MA Tech developer opens the skill in the certification workflow.
2. Runs the skill against representative inputs and adversarial edge cases. All pass. Code review: clean. Description correctly invokes the skill from Claude.
3. MA Tech marks technical certification complete. The skill moves to `internal-ready`.
4. Matt receives notification. He reviews the output quality and methodology alignment. Certifies methodological quality.
5. Both keys recorded. Skill lifecycle state advances to `client-ready`.
6. Derived client-facing version is flagged for review per the derivation lineage tracker.

---
