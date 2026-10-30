# Quantum Channel Lab

An educational, browser-local BB84/B92 simulator built from the issues identified in the supplied design review. It demonstrates transmission, measurement, sifting, sample disclosure, operational alarms, and estimated final BB84 and single-photon B92 key budgets. It does not generate cryptographic keys or operate quantum hardware.

## Run and test

Double-click **QKD Lab.html** to run the complete simulator in your regular browser. No server, account, internet connection, or installed runtime is needed to use it. Computation and run history stay in the browser; exports are saved on your computer. The scientific reference links are optional external pages.

Choose **Protocol → Compare BB84 and B92**, then **Run experiment**, to compare identical settings and seeds side by side. The comparison shows sample QBER, sifting yield, remaining bits, estimated final bits, and channel checks. Inspect either protocol for its detailed results. The exported comparison includes both complete runs. A recommendation selects the larger eligible estimated output among both protocols after target and channel checks. Each uses its own privacy bound. This ranks modeled yield, not intrinsic key security.

Use **Play photons**, **Next photon**, and **Reset** in the channel panel to replay the first 32 actual pulse records from the displayed run. Speed controls emission timing; pause stops the stream while the current illustrative photon finishes traveling. The readout shows preparations, Eve's action, Bob's basis/outcome, and the pre-sampling sifting decision. Matching bits are green, errors orange, and discarded/lost pulses muted. Playback does not change the simulation or generate new randomness. Positions and travel times are illustrative; aggregate statistics cover the entire run rather than just the preview.

The graphs show actual estimated final-key output with the configured target, and analytic QBER curves for a hypothetical intercept-resend sweep on both protocols. Comparison mode shows paired measured output; single mode shows the inspected protocol only. Attack curves retain the selected noise/source/detector settings but vary interception from zero to one; they are not measured trial sweeps and do not represent PNS behavior. All graphs use inline SVG and work offline. Reduced-motion preferences disable photon travel animation while retaining the readout and stepping controls.

For development, use Node.js 22 or newer: `node --test tests.mjs scada.test.mjs offline.test.mjs`. After source changes, run `node build-local.mjs` to rebuild the standalone HTML file before testing. There are no application dependencies or external assets. The same engine runs in the dashboard and automated tests. Downloaded JSON contains the normalized configuration and results for reproducible runs. The offline smoke test uses a minimal DOM harness; it is not a visual browser test.

## Monte Carlo evidence for a guide demonstration

Open the Colab notebook separately and switch tabs manually during the demonstration. The detailed evidence panel and Colab link have been removed from the main application to keep it simple. Colab shows actual pulse outcomes, observed errors and the key-budget calculation; its matching-dashboard link carries only settings and seed. The engine still records up to 128 pulse audit events, and **Export run** includes those records and unrounded budget terms for optional JSON comparison. Removing the panel does not change the engine, photon animation, numerical results or SCADA model.


## SCADA lifecycle and intrusion monitoring

Scroll to **SCADA LAB** and click **Run SCADA experiment**. This captures the current QKD control values, independently chooses BB84, B92, or both, and simulates a configurable duration of substation telemetry and control-center commands. Every tenth message is a downlink command; the others are uplink telemetry containing illustrative voltage and frequency readings. Presets configure healthy supply, intercept-resend, noise burst, authenticated or unauthenticated MITM, and key starvation. Selecting PNS uses a weak-coherent source for that SCADA experiment without editing the main QKD controls.

QKD blocks take pulses/pulseRate plus configured post-processing time, rounded up to the 100 ms scheduler tick. Each completed block uses a new deterministic seed and the actual protocol engine. Approved final-bit estimates become floor(bits/128) session-key units. The finite-capacity pool discards overflow and expired keys; unused fractional key units are not carried forward. Keys expire from creation time, even while queued in the pool. Uplink and downlink use different key IDs, with per-key monotonic message counters, message-use limits, and automatic rotation. Keys that cannot outlive a transmission are retired or cause the in-flight message to be dropped. This is a key-resource scheduling model; the IDs are not secret bytes and no encryption or signatures are performed.

Messages wait for eligible keys, accumulate delay, and are dropped if they cannot arrive before the configured deadline. Full-run metrics report deliveries, pending/dropped messages, latency, deadline misses, estimated bits/s and keys/s, generation interval, pool overflow, expiration, rotation, authentication failures and blocked time. Nominal steady-state demand is 128 times the sum, across both directions, of max(1/keyLifetime, directionMessageRate/messagesPerKey). It is an approximation; expiry, overflow, rotation phase and security recovery can require more. Neither timings nor telemetry deadlines are claimed to match any particular SCADA installation or standard.

The QBER monitor compares each disclosed sample with the configured honest-channel baseline. An increase beyond the configured margin and binomial-tail cutoff triggers a disturbance alarm. Rejected QKD blocks, gain mismatch and failed modeled authentication also trigger quarantine. All pooled/active keys are revoked, in-flight messages are dropped, and queued traffic waits. Only the configured number of consecutive eligible clean rounds can restore service with fresh keys. Insufficient rounds reset this clean streak. A noisy channel can produce the same disturbance alarm as interception; the alarm is not evidence of an identified attacker. The probability cutoff is per round, not a complete-session false-alarm guarantee.

IR/noise exposure is averaged over pulse transmission in a block; an exposed PNS block is conservatively treated as fully attacked. MITM exposure covers the whole QKD exchange. With authentication enabled, an ideal checker and pre-established trust reject impersonation even when QBER is low. Without authentication, new MITM-negotiated keys are flagged compromised by simulator ground truth; existing honest session keys remain private until rotation. Such ground-truth compromise labels are not a QBER-based detector. Authentication bits are already included in the protocol engine's estimated leakage costs; a real authentication bootstrap/exchange is not implemented.

Timeline replay, scrubbing, protocol selection, and speed controls inspect the precomputed simulation without changing it. Charts show QBER with its calibrated baseline and alarmed rounds, pooled key units, queued messages, and approved key supply versus nominal demand. Attack intervals are shaded; block-completion alarms can occur after an attack ends. Full JSON export includes configuration, keys, rounds, messages, snapshots, events, metrics and limitations. Security checks precede delivery in each 100 ms tick and conservatively cancel in-flight messages in the same tick. This model does not connect to real SCADA, Modbus, DNP3, OPC UA, or physical quantum devices.

Scientific context: [ETSI QKD terminology and authenticated classical channels](https://www.etsi.org/deliver/etsi_gr/QKD/001_099/007/01.02.01_60/gr_qkd007v010201p.pdf), [experimental QKD authentication and MITM motivation](https://www.nature.com/articles/s41534-021-00400-7), and [NIST guidance on operational-technology security](https://www.nist.gov/publications/guide-operational-technology-ot-security). These references motivate the scenarios; they do not certify the model or its chosen timing assumptions.

## Gaps addressed

- Separate sampled QBER alarms from the statistical upper bound used for key-budget estimates.
- Account for sample disclosure, error-correction leakage, verification, privacy-amplification overhead, and a stated authentication allocation.
- Model outcome-flip noise, channel loss, detector efficiency, weak coherent source photon numbers, and dark-only random clicks.
- Simulate BB84 and B92 measurements separately; compare results with their distinct analytic predictions.
- Constrain PNS to available multiphoton emissions and flag a gain mismatch when a lossless channel cannot conceal the attack.
- Apply a worst-case source-tagging penalty even when no PNS attack is selected.
- Compute detection overlays from a binomial tail for the selected operational rejection threshold.
- Validate inputs, preserve deterministic replay, discard sampled bits, and expose insufficient-budget and rejected runs.
- Provide responsive controls, preset experiments, comparisons, result export, and visible modeling limitations.

## Limits that remain explicit

The finite-key budget is an instructional approximation, not a composable security proof. The binomial model assumes IID errors; it is not a general finite-population phase-error proof against arbitrary quantum attacks. Error correction and verification are leakage allocations; no Cascade reconciliation, verification exchange, Toeplitz extraction, or authenticated classical channel is performed. The 64-bit authentication allocation is a teaching assumption, not a complete authentication protocol.

B92 now computes an IID single-photon phase-error upper bound and an instructional final-bit budget. It does not perform certified key extraction. The low-noise B92 preset uses 100,000 pulses and 0.5% noise. Weak-coherent B92 extraction remains unsupported and returns zero bits. Its 15% rejection threshold is an illustrative operational alarm, not a security threshold. The loss-sensitive witness accounts for the USD loss limit; an explicit USD attack scenario is not simulated. There are no decoy states, detector side-channel models, hardware calibration, encryption messaging, or real key management. The PRNG is seeded for experiments and is not a cryptographic RNG. Simultaneous signal and dark clicks use the signal outcome.

The source and channel streams are independently seeded; cross-protocol matching is checked in the shared source/channel configuration. Finite samples fluctuate, so an experiment near a threshold can change status with seed. High QBER is not proof of eavesdropping. An insufficient key budget is not itself proof of insecurity. A BB84 ACCEPT result means the configured educational model has a sufficient estimated budget, not that a real system has passed security certification.

## Scientific context

### B92 phase witness implementation

For standard B92 with overlap 1/sqrt(2), let a=(1-1/sqrt(2))/2 and b=1-a. The source-replacement model has Alice marginal P(Ax=1)=a. Use basis [00,01,10,11,0v,1v], with v the vacuum/erasure flag. The standard filter gamma=beta gives conclusive operator C=diag(a,b,a,b,0,0) and phase operator P=diag(0,b,a,0,0,0). The bit-error operator E has blocks 1/2 [[a,-sqrt(ab)],[-sqrt(ab),b]] on [00,11] and 1/2 [[b,-sqrt(ab)],[-sqrt(ab),a]] on [01,10]. Loss V=diag(0,0,0,0,1,1); Alice marginal A=diag(0,0,1,1,0,1).

For any coefficients le>=0, lc, lv, la, set t to an upper bound on the largest eigenvalue of P-le E-lc C-lv V-la A. Then the ensemble joint phase probability is at most t+le eUpper+max(lc cLower,lc cUpper)+max(lv lossLower,lv lossUpper)+la a. Two analytic 2x2 eigenvalues and two vacuum entries compute t, with a positive numerical tolerance. Deterministic coordinate search and simplex refinement seek a tighter witness; convergence to the global optimum is not claimed or required for the operator inequality. Suboptimal search reduces estimated output.

Conclusive and loss probabilities use two-sided binomial KL intervals over all pulses. The sampled conditional bit-error interval and conclusive upper bound give eUpper. Three interval families each receive eps/3; each two-sided interval uses log(2/epsilon)/trials. Divide the joint phase bound by the conclusive lower bound and cap at 1/2 for privacy entropy. Negative inconsistent bounds fail closed. For weak coherent sources or missing observations, output is unsupported/insufficient and zero.

The final instructional budget is floor(nRemaining*(1-h2(phaseUpper))-1.16*nRemaining*h2(sampleQBER)-34-64-2*log2(1/eps)), clamped at zero. This bounds an IID ensemble phase rate. It does not establish the undisclosed finite block's smooth min-entropy or constitute a composable coherent-attack finite-key proof. Erasure and random-qubit replacement model detector inefficiency and dark-only clicks; real detector filtering and side channels are not certified. No actual reconciliation, extraction, or authentication protocol is performed.

[Gottesman, Lo, Lütkenhaus and Preskill](https://arxiv.org/abs/quant-ph/0212066) analyze imperfect-device BB84. [Tamaki and Lütkenhaus](https://arxiv.org/abs/quant-ph/0308048) analyze B92 over lossy and noisy channels. These papers provide context; this simulator does not implement their complete proofs.

## Deployment

Live Vercel demo: https://vercel-demo-navy-psi.vercel.app/ (project `vercel-demo`). The deployed artifact includes the channel builder, protocol comparison, photon replay, graphs, and SCADA lifecycle/intrusion lab. Rebuild and deploy from `vercel-demo/` with `npx vercel --prod` for future updates. The offline HTML remains available separately.

The standalone local HTML file remains usable offline. The Sites manifest identifies the earlier private deployment; local builds do not update it. Visitors do not need accounts; shared online rooms use role invitation links and a private backend store.

For the requested Vercel guide demo, run `node prepare-vercel.mjs`. This rebuilds the current offline artifact into `vercel-demo/public/index.html`, copies the live role pages, and prepares the shared-session API. Deploy only `vercel-demo/`, not the project root: the demo folder contains the application and hosting configuration without the original document, Git history, old hosting metadata or test tooling.

With Vercel CLI access to your account, open a terminal in `vercel-demo/` and run `npx vercel --prod`. Use an existing account/project or create the intended demo project when prompted. This command requires Vercel authentication. Deployment has not occurred merely because the folder was prepared. After a successful deployment, share its production domain with the guide and verify whether the project's access protection permits the intended visitor. Keep the simulator's educational-model limitations visible.

## Shared online role demo

### SCADA telemetry file experiment

New rooms include a sample `grid-telemetry.csv` (time, voltage and frequency). Before starting, the sender can upload a replacement file of 1–24,576 bytes. It is stored in the room's private record, with its SHA-256, and cannot be replaced after the run starts. Each accepted QKD round releases up to 1,024 bytes to the receiver buffer after the round's checks. This is an explicit modeled 128-bit session-key gate, not a one-time pad: estimated QKD bits are not equated with file bits or used as real encryption keys. Actual byte transport is HTTPS. Failed and recovery rounds release zero bytes; resumed rounds continue from the last offset without duplicate chunks. Previously delivered bytes remain delivered if an attack occurs later.

Only the receiver projection includes the released file prefix. Once complete, the receiver browser checks SHA-256 against the original, acknowledges receipt to the server and enables a download of the exact original bytes and filename. SHA-256 establishes byte equality under the trusted service model, not endpoint identity or QKD security. All thirty rounds still run, even if the file arrives early. At round 30, the outcome explicitly names BB84 or B92: incomplete if bytes are missing, awaiting receiver verification if all bytes are available but unconfirmed, or file transferred when the receiver has confirmed. The receiver can reconnect after round 30 to confirm/download before room expiry. Without classical authentication, successful delivery does not imply confidentiality; simulated MITM exposure is tracked separately in Eve's view.

The final graphs show cumulative delivery percentage, bytes released per round, and estimated key bits per round (including rejected budgets, colored by disposition). The existing QBER graph remains visible. File-transfer outcomes are distinct from the original timed-SCADA scheduler, which models message deadlines and key pools; this live extension represents a control-center-to-substation telemetry-file experiment rather than physical grid control.

Validation: `node --test tests.mjs scada.test.mjs offline.test.mjs live.test.mjs run-link.test.mjs` (73 tests). `live-browser.test.mjs` tests actual upload, blocked chunks, recovery, byte-identical receiver download and final graphs through three isolated browser contexts. Its default transport uses a controllable in-memory session clock to cover all 30 rounds; with `LIVE_URL` it tests the deployed service in real time. `PLAYWRIGHT_PATH` may point to an existing Playwright installation. No uploaded file is sent to the attacker role. Dormant private room records require administrator cleanup as described below.

Open `/live.html` on the Vercel deployment and create a room. Share its separate Sender, Receiver, and Attacker invitation links with three devices. The receiver clicks Join; the sender clicks Start. Healthy rounds produce matching **illustrative markers**, not usable QKD keys. Eve can apply intercept-resend, noise, or MITM during the exchange. Endpoints learn about disturbance only when the round is measured and checked. Stop an attack and allow two clean accepted rounds for recovery. Stop on the sender page clears the current marker.

Each 12-second round represents 100,000 pulses, with 70% of the animation allocated to transmission and the rest to sifting/testing. Attack exposure is weighted only across the remaining transmission window; MITM covers the classical exchange too. The existing QKD engine computes the final budget; the shared-room model is distinct from the SCADA traffic scheduler. It does not transmit actual SCADA packets or implement reconciliation, encryption, or physical photons. Markers are random server-generated teaching aids. Without authentication, MITM may leave QBER low and expose a newly accepted marker; only the attacker's ground-truth view reports that compromise.

Shared state lives in private Vercel Blob storage, read without CDN caching. Conditional ETag writes serialize simultaneous participants; no process-memory room store is used. Each role has a random 192-bit bearer capability in the URL fragment, sent only in POST bodies; role projections omit other capabilities and endpoint data. Anyone with a role link can act as that role: this is classroom access control, not user identity authentication. Links expire after one hour; sessions stop after 30 rounds, accept at most 200 attack-control changes, and reconnect by polling every three seconds. Expired room data is deleted when accessed after expiry; dormant records require administrator cleanup. Public room creation is intended for a small classroom demo; add account-based quotas/rate limiting before broad public promotion.

`live/` contains the UI, session model, and API. Run `node --test live.test.mjs` for lifecycle and role tests. Install its pinned dependency with `npm ci --prefix live`; then `node prepare-vercel.mjs` builds a `public/` output folder plus the `/api/room` Vercel Function. Keep `BLOB_READ_WRITE_TOKEN` in the Vercel production environment only. `.env*`, dependencies, and the old static index are excluded from upload. The original offline artifact still runs its local channel and SCADA experiments; the new shared room requires internet.


# Separate simulation walkthrough

Open `simulation.html` (or `/simulation.html` on the hosted demo). Run an experiment, inspect the actual pulse records and arithmetic, then click **Open matching dashboard**. The link carries only settings and the seed; the dashboard runs the same engine again. The Colab notebook is opened separately for the guide demonstration; this earlier standalone walkthrough remains accessible directly. This demonstrates the calculation path and reproducibility, not independent verification by another implementation. The raw bit preview covers at most 128 pulses; full-run counters cover every pulse. Final output is an estimated length, not an extracted secret key.

# Run the same simulation in Google Colab

[![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/Tanayqq/qkd-scada-lab/blob/main/notebooks/QKD_Colab_Demonstration.ipynb)

Open `notebooks/QKD_Colab_Demonstration.ipynb`, choose **Runtime → Run all**, and use the generated **Open matching application dashboard** link. The notebook runs an embedded, inspectable snapshot of the same JavaScript engine in a separate Node.js process; Python supplies the notebook controls and displays the calculated output. Only inputs and seed are sent in the dashboard link. It is a portability/reproducibility demonstration, not an independent implementation or a real secure-key extractor. It includes pulse evidence, key-budget arithmetic, repeatability checks, four ideal-model behaviour checks and optional comparison against an exported application JSON. The six executable cells were checked locally; a Colab runtime is required for the optional Colab file-upload dialog. Regenerate the snapshot after changing the engine. No application hosting changes are needed.

