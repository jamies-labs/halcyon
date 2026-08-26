import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="shell" data-testid="mission-console">
    <header class="masthead">
      <p class="eyebrow">ISV HALCYON / survey vessel</p>
      <h1>ISV HALCYON</h1>
      <p class="lede">Emergency wake cycle is holding steady.</p>
    </header>

    <section class="console-panel" aria-labelledby="ship-status-heading">
      <div class="signal-line" aria-hidden="true"></div>
      <div class="panel-heading">
        <p class="eyebrow">Crew status</p>
        <h2 id="ship-status-heading">One crew member awake</h2>
      </div>
      <dl class="status-list">
        <div><dt>Hull</dt><dd>Stable</dd></div>
        <div><dt>Agent link</dt><dd>Crew link pending</dd></div>
        <div><dt>Next step</dt><dd>Share the mission brief</dd></div>
      </dl>
      <button class="briefing-button" type="button" data-testid="open-crew-briefing" aria-expanded="false" aria-controls="crew-briefing">
        Open crew briefing
      </button>
    </section>

    <section class="crew-briefing" id="crew-briefing" data-testid="crew-briefing" aria-labelledby="crew-briefing-heading" hidden tabindex="-1">
      <p class="eyebrow">Crew briefing</p>
      <h2 id="crew-briefing-heading">The ship needs two crew.</h2>
      <p>HALCYON listens through your agent. Open its tools, compare what each of you can see, and bring the ship home together.</p>
    </section>
  </main>
`;

const briefingButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="open-crew-briefing"]',
)!;
const briefing = document.querySelector<HTMLElement>(
  '[data-testid="crew-briefing"]',
)!;

briefingButton.addEventListener("click", () => {
  briefing.hidden = false;
  briefingButton.setAttribute("aria-expanded", "true");
  briefing.focus();
});
