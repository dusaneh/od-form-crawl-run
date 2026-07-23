import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const sharedStyles = `
  :root { color-scheme: light; font: 16px/1.45 system-ui, sans-serif; }
  * { box-sizing: border-box; }
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
            <button type="submit">Continue</button>
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
              <div role="combobox" aria-label="Neighborhood" aria-required="true" tabindex="0">Choose a neighborhood</div>
              <div role="switch" aria-label="Text message updates" tabindex="0"></div>
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
        </main>`
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
            <button>Review request</button>
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
          <form action="/fixtures/write-probe" method="post">
            <fieldset>
              <legend>Do you have dependents?</legend>
              <label><input type="radio" name="has_dependents" value="yes"> Yes</label>
              <label><input type="radio" name="has_dependents" value="no"> No</label>
            </fieldset>
            <section id="dependent-details" hidden>
              <label>Number of dependents <input name="dependent_count" type="number" min="1"></label>
            </section>
            <label>Annual household income <input name="annual_income" inputmode="decimal" required></label>
            <button type="submit">Check eligibility</button>
          </form>
        </main>`,
        {
          scripts: `<script>
            document.querySelectorAll('[name="has_dependents"]').forEach((field) => {
              field.addEventListener("change", () => {
                document.querySelector("#dependent-details").hidden = field.value !== "yes";
              });
            });
          </script>`,
        }
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
                  <button type="submit">Review application</button>
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
    requests.push({
      at: new Date().toISOString(),
      method: request.method || "GET",
      path: url.pathname,
    });

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
