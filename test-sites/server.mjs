import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const sharedStyles = `
  :root { color-scheme: light; font: 16px/1.45 system-ui, sans-serif; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; color: #17372c; background: #eef5f0; }
  header, footer { padding: 18px 6vw; color: white; background: #123d30; }
  nav { display: flex; flex-wrap: wrap; gap: 16px; }
  nav a { color: #c9ffe8; }
  main { width: min(850px, 90vw); margin: 32px auto; padding: 28px; background: white; border-radius: 14px; }
  form { display: grid; gap: 16px; margin: 24px 0; padding: 22px; border: 1px solid #cfded5; border-radius: 10px; }
  label, fieldset { display: grid; gap: 6px; }
  input, select, textarea, [role="combobox"], [role="textbox"] { min-height: 42px; padding: 9px; border: 1px solid #8fa89a; border-radius: 6px; }
  button { width: max-content; padding: 10px 16px; }
  .ad, .cookie, .promo { padding: 14px; color: #5d5240; background: #fff3d3; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;

function layout(title, body, { scripts = "" } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>${sharedStyles}</style>
  </head>
  <body>
    <header>
      <strong>Fixture County Services</strong>
      <nav>
        <a href="/fixtures/start">Forms</a>
        <a href="/about">About us</a>
        <a href="/press">Press releases</a>
      </nav>
    </header>
    ${body}
    <footer>Fixture content only. Do not enter real personal information.</footer>
    ${scripts}
  </body>
</html>`;
}

const routes = new Map([
  [
    "/fixtures/start",
    () =>
      layout(
        "Form crawl fixture index",
        `<main>
          <h1>Public service forms</h1>
          <p>This index intentionally mixes useful form links with ordinary site navigation.</p>
          <div class="promo">Applications close whenever the integration test ends.</div>
          <ul>
            <li><a href="/fixtures/semantic-application">Semantic benefits application</a></li>
            <li><a href="/fixtures/messy-intake?campaign=summer">Messy community intake</a></li>
            <li><a href="/fixtures/spa-enrollment">JavaScript enrollment form</a></li>
            <li><a href="/fixtures/iframe-request">Embedded service request</a></li>
            <li><a href="/fixtures/shadow-form">Web-component contact form</a></li>
            <li><a href="/fixtures/conditional-wizard">Conditional multi-step form</a></li>
            <li><a href="/fixtures/automation-gates">Consent and overlay gated application</a></li>
            <li><a href="/fixtures/captcha-gate">Human-verification review fixture</a></li>
            <li><a href="/fixtures/styled-label-interception">Styled-label pointer interception</a></li>
            <li><a href="/fixtures/probe-defeating-widget">Probe-defeating choice widget</a></li>
            <li><a href="/fixtures/interaction-gated-delay">Interaction-gated delayed form</a></li>
            <li><a href="/fixtures/decoy-before-real">Decoy forms before real application</a></li>
          </ul>
          <a href="/about">Read our annual report</a>
        </main>`
      ),
  ],
  [
    "/fixtures/semantic-application",
    () =>
      layout(
        "Semantic benefits application",
        `<main>
          <h1>Household support application</h1>
          <p>Clean native markup provides a baseline for extraction.</p>
          <form method="post" action="/fixtures/write-probe">
            <input type="hidden" name="csrf_token" value="fixture-only">
            <label for="legal-name">Legal name</label>
            <input id="legal-name" name="legal_name" autocomplete="name" required>
            <label>Email address <input type="email" name="email" autocomplete="email" required></label>
            <label for="household-size">Household size</label>
            <select id="household-size" name="household_size" required>
              <option value="">Choose one</option>
              <option>1</option><option>2</option><option>3+</option>
            </select>
            <fieldset>
              <legend>Preferred contact method</legend>
              <label><input type="radio" name="contact_method" value="email" required> Email</label>
              <label><input type="radio" name="contact_method" value="phone"> Phone</label>
            </fieldset>
            <label><input type="checkbox" name="attestation" required> I attest this fixture is synthetic</label>
            <button type="submit">Submit application</button>
          </form>
        </main>`
      ),
  ],
  [
    "/fixtures/messy-intake",
    () =>
      layout(
        "Messy community intake",
        `<aside class="cookie">This fake cookie banner exists to create normal page noise. <button>Accept</button></aside>
        <main>
          <div class="ad">Advertisement: definitely not part of the application.</div>
          <h1>Community assistance — tell us what happened</h1>
          <form role="search" action="/fixtures/messy-intake">
            <label class="visually-hidden" for="site-search">Search this site</label>
            <input id="site-search" name="q" type="search" placeholder="Search all programs">
            <button>Search</button>
          </form>
          <section>
            <p id="help-for-nickname">This can be a nickname.</p>
            <form method="post" action="/fixtures/write-probe" novalidate>
              <div><span id="applicant-label">Applicant display name</span></div>
              <input aria-labelledby="applicant-label help-for-nickname" name="displayName" required>
              <label>Best phone? <input type="tel" name="contact[phone]" autocomplete="tel"></label>
              <label for="story">Please describe your situation</label>
              <textarea id="story" data-field="assistance_story" aria-required="true"></textarea>
              <div role="combobox" aria-label="Neighborhood" aria-required="true" aria-expanded="false" tabindex="0">Choose a neighborhood</div>
              <div role="switch" aria-label="Text message updates" aria-checked="false" tabindex="0" style="min-height:42px;padding:9px;border:1px solid #8fa89a">Off</div>
              <input title="Unlabelled reference number" data-field="reference_number">
              <input type="hidden" name="tracking_id" value="noise-123">
              <input name="future_detail" aria-label="Future conditional detail" style="display:none">
              <button type="submit">Send request</button>
            </form>
          </section>
          <form action="/fixtures/newsletter">
            <label>Newsletter email <input name="newsletter_email" type="email"></label>
            <button>Subscribe</button>
          </form>
        </main>`,
        {
          scripts: `<script>
            const neighborhood = document.querySelector('[role="combobox"][aria-label="Neighborhood"]');
            neighborhood.addEventListener("click", () => {
              neighborhood.setAttribute("aria-expanded", "true");
            });
            neighborhood.addEventListener("keydown", (event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                neighborhood.setAttribute("aria-expanded", "true");
              }
              if (event.key === "Enter") {
                event.preventDefault();
                neighborhood.textContent = "North test district";
                neighborhood.setAttribute("aria-expanded", "false");
              }
            });
            const updateSwitch = document.querySelector('[role="switch"][aria-label="Text message updates"]');
            updateSwitch.addEventListener("click", () => {
              const next = updateSwitch.getAttribute("aria-checked") !== "true";
              updateSwitch.setAttribute("aria-checked", String(next));
              updateSwitch.textContent = next ? "On" : "Off";
            });
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/spa-enrollment",
    () =>
      layout(
        "Client-rendered enrollment",
        `<main>
          <h1>Program enrollment</h1>
          <p>The form below does not exist in the server HTML. JavaScript creates it after load.</p>
          <div id="spa-root" aria-live="polite">Loading enrollment module…</div>
        </main>`,
        {
          scripts: `<script>
            setTimeout(() => {
              document.querySelector("#spa-root").innerHTML = \`
                <form id="spa-form" action="/fixtures/write-probe" method="post">
                  <label>Participant email <input type="email" name="participant_email" required></label>
                  <label for="program-code">Program code</label>
                  <input id="program-code" name="programCode" aria-required="true">
                  <label>Start date <input type="date" name="start_date"></label>
                  <button type="submit">Enroll</button>
                </form>\`;
              fetch("/fixtures/write-probe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ shouldNeverReachServer: true })
              }).catch(() => {});
            }, 180);
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/iframe-request",
    () =>
      layout(
        "Embedded service request",
        `<main>
          <h1>Request a replacement card</h1>
          <p>The operational form is rendered inside a same-origin iframe.</p>
          <iframe title="Replacement card request" src="/fixtures/embedded-intake" width="100%" height="430"></iframe>
        </main>`
      ),
  ],
  [
    "/fixtures/embedded-intake",
    () =>
      layout(
        "Embedded card form",
        `<main>
          <h1>Card details</h1>
          <form method="post" action="/fixtures/write-probe">
            <label>Member number <input name="member_number" required></label>
            <label>Mailing ZIP code <input name="mailing_zip" inputmode="numeric" required></label>
            <label>Reason
              <select name="replacement_reason">
                <option>Lost</option><option>Damaged</option><option>Never arrived</option>
              </select>
            </label>
            <button>Submit request</button>
          </form>
        </main>`
      ),
  ],
  [
    "/fixtures/shadow-form",
    () =>
      layout(
        "Shadow DOM contact form",
        `<main>
          <h1>Contact a case worker</h1>
          <p>The form controls live in an open shadow root.</p>
          <case-worker-form></case-worker-form>
        </main>`,
        {
          scripts: `<script>
            customElements.define("case-worker-form", class extends HTMLElement {
              connectedCallback() {
                const root = this.attachShadow({ mode: "open" });
                root.innerHTML = \`
                  <style>form{display:grid;gap:12px;padding:18px;border:1px solid #aaa}label{display:grid}</style>
                  <form action="/fixtures/write-probe" method="post">
                    <label>Case ID <input name="case_id" required></label>
                    <label>Reply email <input name="reply_email" type="email"></label>
                    <label>Question <textarea name="case_question" required></textarea></label>
                    <button>Send question</button>
                  </form>\`;
              }
            });
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/conditional-wizard",
    () =>
      layout(
        "Conditional household wizard",
        `<main>
          <h1>Household eligibility screener</h1>
          <p>This three-state form autosaves synthetic changes and ends at an explicit final submit boundary.</p>
          <div id="wizard-root"></div>
        </main>`,
        {
          scripts: `<script>
            const root = document.querySelector("#wizard-root");
            const state = { step: 1, values: {} };
            const autosave = (source) => {
              fetch("/fixtures/autosave", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ source, step: state.step, values: state.values })
              }).catch(() => {});
            };
            const bindValues = () => {
              root.querySelectorAll("input,select,textarea").forEach((field) => {
                field.addEventListener("change", () => {
                  state.values[field.name] =
                    field.type === "checkbox" ? field.checked : field.value;
                  if (field.name === "has_dependents") {
                    document.querySelector("#dependent-details").hidden =
                      field.value !== "yes";
                  }
                  if (field.name === "program") {
                    document.querySelector("#program-details").hidden = !field.value;
                    document.querySelector("#program-code-label").textContent =
                      field.value === "energy" ? "Utility program code" : "Housing program code";
                  }
                  if (field.name === "updates") {
                    document.querySelector("#updates-email").hidden = !field.checked;
                  }
                  if (field.name === "contact_method") {
                    const emailLabel = document.querySelector("#email-contact");
                    const phoneLabel = document.querySelector("#phone-contact");
                    emailLabel.hidden = field.value !== "email";
                    phoneLabel.hidden = field.value !== "phone";
                    emailLabel.querySelector("input").disabled =
                      field.value !== "email";
                    phoneLabel.querySelector("input").disabled =
                      field.value !== "phone";
                  }
                  autosave(field.name);
                });
              });
            };
            const stepOne = () => {
              state.step = 1;
              root.innerHTML = \`
                <form id="wizard-step-one">
                  <label>Applicant name <input name="applicant_name" autocomplete="name" required></label>
                  <label>Program
                    <select name="program" required>
                      <option value="">Choose one</option>
                      <option value="energy">Energy assistance</option>
                      <option value="housing">Housing assistance</option>
                    </select>
                  </label>
                  <section id="program-details" hidden>
                    <label><span id="program-code-label">Program code</span>
                      <input name="program_code" required>
                    </label>
                  </section>
                  <fieldset>
                    <legend>Do you have dependents?</legend>
                    <label><input type="radio" name="has_dependents" value="yes"> Yes</label>
                    <label><input type="radio" name="has_dependents" value="no"> No</label>
                  </fieldset>
                  <section id="dependent-details" hidden>
                    <label>Number of dependents <input name="dependent_count" type="number" min="1" max="12"></label>
                  </section>
                  <label><input type="checkbox" name="updates"> Exercise optional update preferences</label>
                  <label id="updates-email" hidden>Updates email <input name="updates_email" type="email"></label>
                  <label>Annual household income <input name="annual_income" type="number" min="0" required></label>
                  <button type="submit">Next: contact details</button>
                </form>\`;
              root.querySelector("form").addEventListener("submit", (event) => {
                event.preventDefault();
                autosave("step_one_advance");
                stepTwo();
              });
              bindValues();
            };
            const stepTwo = () => {
              state.step = 2;
              root.innerHTML = \`
                <form id="wizard-step-two">
                  <label>Preferred contact method
                    <select name="contact_method" required>
                      <option value="">Choose one</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                    </select>
                  </label>
                  <label id="email-contact" hidden>Contact email <input name="contact_email" type="email" required disabled></label>
                  <label id="phone-contact" hidden>Contact phone <input name="contact_phone" type="tel" required disabled></label>
                  <label>Service address <input name="service_address" autocomplete="street-address" required></label>
                  <label>Service ZIP <input name="service_zip" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label>
                  <button type="submit">Review application</button>
                </form>\`;
              root.querySelector("form").addEventListener("submit", (event) => {
                event.preventDefault();
                autosave("step_two_advance");
                stepThree();
              });
              bindValues();
            };
            const stepThree = () => {
              state.step = 3;
              root.innerHTML = \`
                <form id="wizard-step-three" method="post" action="/fixtures/live-submit">
                  <h2>Review synthetic application</h2>
                  <p id="review-summary">All values in this fixture are synthetic.</p>
                  <input type="hidden" name="fixture_run" value="formweave">
                  <button type="submit">Submit test application</button>
                </form>\`;
            };
            stepOne();
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/failing-submit",
    () =>
      layout(
        "Rejected synthetic submission",
        `<main>
          <h1>Rejected fixture application</h1>
          <p>This fixture reaches a terminal boundary whose rendered response explicitly reports failure.</p>
          <form method="post" action="/fixtures/live-submit-failure">
            <label>Fixture reference <input name="fixture_reference" pattern="[A-Z]{2}[0-9]{4}" required></label>
            <button type="submit">Submit rejected test application</button>
          </form>
        </main>`,
      ),
  ],
  [
    "/fixtures/automation-gates",
    () =>
      layout(
        "Predictable traversal gates",
        `<div id="onetrust-consent-sdk">
          <section
            id="onetrust-banner-sdk"
            role="dialog"
            aria-modal="true"
            aria-label="Cookie preferences"
            style="position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(10,30,22,.66)"
          >
            <div style="width:min(560px,90vw);padding:24px;border-radius:12px;background:white">
              <h2>Cookie choices</h2>
              <p>Choose how this synthetic public application stores browser cookies.</p>
              <button id="onetrust-reject-all-handler" type="button">Reject Non-Essential Cookies</button>
              <button id="onetrust-accept-btn-handler" type="button">Accept All Cookies</button>
            </div>
          </section>
        </div>
        <main>
          <h1>Energy assistance application</h1>
          <p>This noisy app requires a same-origin component bootstrap and several predictable dismissals.</p>
          <div class="ad">Sponsored message: save energy by testing your crawl policy.</div>
          <div id="application-root" aria-live="polite">Loading application shell…</div>
        </main>`,
        {
          scripts: `<script>
            const state = { initialized: false, consent: false, stage: "cookie" };
            const root = document.querySelector("#application-root");
            const showWelcome = () => {
              if (!state.initialized || !state.consent || state.stage !== "cookie") return;
              state.stage = "welcome";
              root.innerHTML = \`
                <section class="welcome-modal" role="dialog" aria-modal="true" aria-label="Welcome">
                  <h2>Welcome to the application</h2>
                  <p>This short tour is optional.</p>
                  <button type="button" id="close-welcome">Got it</button>
                </section>\`;
              document.querySelector("#close-welcome").addEventListener("click", () => {
                state.stage = "auth";
                root.innerHTML = \`
                  <section class="registration-popup" role="dialog" aria-modal="true" aria-label="Registration offer">
                    <h2>Save your progress?</h2>
                    <p>Creating an account is optional for this public form.</p>
                    <button type="button" id="continue-guest">Continue as guest</button>
                  </section>\`;
                document.querySelector("#continue-guest").addEventListener("click", showOffer);
              });
            };
            const showOffer = () => {
              state.stage = "offer";
              root.innerHTML = \`
                <section class="promo-popup" role="dialog" aria-modal="true" aria-label="Optional updates">
                  <h2>Get program updates</h2>
                  <p>This newsletter offer is optional.</p>
                  <button type="button" id="decline-offer">No thanks</button>
                </section>\`;
              document.querySelector("#decline-offer").addEventListener("click", showForm);
            };
            const showForm = () => {
              state.stage = "form";
              root.innerHTML = \`
                <button type="button" aria-expanded="false" aria-controls="eligibility-help" id="help-toggle">More eligibility details</button>
                <p id="eligibility-help" hidden>Household income documentation may be requested later.</p>
                <form method="post" action="/fixtures/write-probe">
                  <label>Application reference <input name="application_reference" required></label>
                  <label>Service ZIP code <input name="service_zip" inputmode="numeric" required></label>
                  <label>Assistance program
                    <select name="assistance_program" required>
                      <option value="">Choose one</option>
                      <option>CARE</option>
                      <option>FERA</option>
                    </select>
                  </label>
                  <button type="submit">Submit application</button>
                </form>\`;
              const toggle = document.querySelector("#help-toggle");
              toggle.addEventListener("click", () => {
                const help = document.querySelector("#eligibility-help");
                help.hidden = false;
                toggle.setAttribute("aria-expanded", "true");
              });
            };
            const consent = () => {
              state.consent = true;
              document.querySelector("#onetrust-consent-sdk").remove();
              fetch("/fixtures/write-probe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ analyticsConsentReceipt: true })
              }).catch(() => {});
              showWelcome();
            };
            document.querySelector("#onetrust-reject-all-handler").addEventListener("click", consent);
            document.querySelector("#onetrust-accept-btn-handler").addEventListener("click", consent);
            setTimeout(() => {
              fetch("/fixtures/aura", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ descriptor: "markup://fixture:application" })
              })
                .then((response) => response.json())
                .then(() => {
                  state.initialized = true;
                  showWelcome();
                })
                .catch(() => {
                  root.textContent = "Application initialization was blocked.";
                });
            }, 120);
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/captcha-gate",
    () =>
      layout(
        "Human verification gate",
        `<main>
          <h1>Permit application verification</h1>
          <p>This fixture proves that a challenge is captured for review and never clicked.</p>
          <section role="dialog" aria-modal="true" aria-label="Security check">
            <h2>Verify that you are human</h2>
            <div class="g-recaptcha" data-sitekey="fixture-only">
              <button type="button" id="human-check">I am human</button>
            </div>
            <p id="challenge-result">Waiting for a person.</p>
          </section>
        </main>`,
        {
          scripts: `<script>
            document.querySelector("#human-check").addEventListener("click", () => {
              document.querySelector("#challenge-result").textContent = "AUTOMATION CLICKED THE CAPTCHA";
              document.body.dataset.captchaClicked = "true";
            });
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/styled-label-interception",
    () =>
      layout(
        "Styled label interception fixture",
        `<main>
          <h1>Styled housing preference</h1>
          <p>The native choice is visually hidden beneath a label that receives pointer events.</p>
          <form method="post" action="/fixtures/write-probe">
            <fieldset>
              <legend>Housing type</legend>
              <label class="slds-radio" style="position:relative;padding:12px;border:1px solid #789">
                <input style="position:absolute;opacity:.01;pointer-events:none" type="radio" name="housing_type" value="temporary" required>
                <span style="position:relative;z-index:2">Temporary housing</span>
              </label>
              <label class="slds-radio" style="position:relative;padding:12px;border:1px solid #789">
                <input style="position:absolute;opacity:.01;pointer-events:none" type="radio" name="housing_type" value="permanent">
                <span style="position:relative;z-index:2">Permanent housing</span>
              </label>
            </fieldset>
            <label>Fixture reference <input name="fixture_reference" pattern="[0-9]{10}" required></label>
            <button type="submit">Submit application</button>
          </form>
        </main>`
      ),
  ],
  [
    "/fixtures/probe-defeating-widget",
    () =>
      layout(
        "Probe-defeating widget fixture",
        `<main>
          <h1>JavaScript choice control</h1>
          <form method="post" action="/fixtures/write-probe">
            <div role="radiogroup" aria-label="Assistance track">
              <div role="radio" name="assistance_track" data-value="rapid" aria-checked="false" tabindex="0">Rapid rehousing</div>
              <div role="radio" name="assistance_track" data-value="prevention" aria-checked="false" tabindex="0">Eviction prevention</div>
            </div>
            <label>Case number <input name="case_number" required></label>
            <button type="submit">Submit application</button>
          </form>
        </main>`,
        {
          scripts: `<script>
            document.querySelectorAll('[role="radio"]').forEach((choice) => {
              choice.addEventListener("click", (event) => {
                if (event.detail !== 2) return;
                document.querySelectorAll('[role="radio"]').forEach((item) => item.setAttribute("aria-checked", "false"));
                choice.setAttribute("aria-checked", "true");
              });
            });
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/interaction-gated-delay",
    () =>
      layout(
        "Interaction-gated delayed form",
        `<main>
          <h1>Delayed trusted-input application</h1>
          <p id="interaction-instruction">Move the pointer to initialize the public form.</p>
          <div id="delayed-root">Waiting for trusted interaction…</div>
        </main>`,
        {
          scripts: `<script>
            let started = false;
            window.addEventListener("pointermove", (event) => {
              if (started || !event.isTrusted) return;
              started = true;
              setTimeout(() => {
                document.querySelector("#delayed-root").innerHTML = \`
                  <form method="post" action="/fixtures/write-probe">
                    <label>Program code <input name="program_code" pattern="[A-Z]{2}[0-9]{4}" required></label>
                    <label>Applicant email <input type="email" name="applicant_email" required></label>
                    <button type="submit">Submit application</button>
                  </form>\`;
              }, 450);
            }, { once: true });
          </script>`,
        }
      ),
  ],
  [
    "/fixtures/decoy-before-real",
    () =>
      layout(
        "Decoys before application fixture",
        `<main>
          <h1>Housing stabilization application</h1>
          <form aria-label="Site search" action="/fixtures/decoy-before-real">
            <label>Search this site <input type="search" name="q"></label>
            <button type="submit">Search</button>
          </form>
          <form aria-label="Newsletter signup" action="/fixtures/write-probe">
            <label>Newsletter email <input type="email" name="newsletter_email"></label>
            <button type="submit">Subscribe</button>
          </form>
          <div role="form" aria-label="Chat widget">
            <label>Chat message <input name="chat_message"></label>
          </div>
          <section aria-label="Real housing application">
            <form id="real-housing-application" method="post" action="/fixtures/write-probe">
              <label>Applicant first name <input name="applicant_first_name" required></label>
              <label>Household income <input name="household_income" inputmode="numeric" required></label>
              <button type="submit">Submit application</button>
            </form>
          </section>
        </main>`
      ),
  ],
  [
    "/about",
    () =>
      layout(
        "About Fixture County",
        `<main><h1>About this test site</h1><p>This ordinary content page should not be discovered as a form workflow.</p></main>`
      ),
  ],
  [
    "/press",
    () =>
      layout(
        "Fixture County press",
        `<main><h1>Press releases</h1><p>More non-form navigation noise.</p></main>`
      ),
  ],
]);

function send(response, status, body, contentType = "text/html; charset=utf-8") {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-fixture-site": "formweave",
  });
  response.end(body);
}

export async function startFixtureServer({ host = "127.0.0.1", port = 0 } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    const requestRecord = {
      at: new Date().toISOString(),
      method: request.method || "GET",
      path: url.pathname,
    };
    requests.push(requestRecord);

    if (url.pathname === "/fixtures/write-probe") {
      send(
        response,
        409,
        JSON.stringify({ error: "A crawler write reached the fixture server." }),
        "application/json; charset=utf-8"
      );
      return;
    }
    if (url.pathname === "/fixtures/aura" && request.method === "POST") {
      send(
        response,
        200,
        JSON.stringify({ ready: true, component: "fixture:application" }),
        "application/json; charset=utf-8"
      );
      return;
    }
    if (url.pathname === "/fixtures/autosave" && request.method === "POST") {
      send(
        response,
        200,
        JSON.stringify({ saved: true, synthetic: true }),
        "application/json; charset=utf-8"
      );
      return;
    }
    if (url.pathname === "/fixtures/live-submit" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        requestRecord.body = body.slice(0, 2_000);
        send(
          response,
          200,
          layout(
            "Synthetic submission received",
            `<main>
              <h1>Submission received</h1>
              <p id="submission-confirmation">The repository-owned fixture accepted the synthetic live-mode submission.</p>
            </main>`
          )
        );
      });
      return;
    }
    if (
      url.pathname === "/fixtures/live-submit-failure" &&
      request.method === "POST"
    ) {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        requestRecord.body = body.slice(0, 2_000);
        send(
          response,
          422,
          layout(
            "Synthetic submission failed",
            `<main>
              <h1>Submission failed</h1>
              <p id="submission-failure">The repository-owned fixture rejected the synthetic submission. Nothing was received.</p>
            </main>`,
          ),
        );
      });
      return;
    }
    const render = routes.get(url.pathname);
    if (!render) {
      send(response, 404, layout("Not found", "<main><h1>Not found</h1></main>"));
      return;
    }
    send(response, 200, render());
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  return {
    host,
    port: resolvedPort,
    origin: `http://${host}:${resolvedPort}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestedPort = Number.parseInt(process.env.FORMWEAVE_FIXTURE_PORT || "4179", 10);
  const fixture = await startFixtureServer({ port: requestedPort });
  console.log(`FormWeave crawl fixtures: ${fixture.origin}/fixtures/start`);
}
