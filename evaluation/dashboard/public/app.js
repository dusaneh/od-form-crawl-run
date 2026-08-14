const ROLE_COLORS = {
  fix: "#f3b35d",
  regression: "#68d8ae",
  rotating: "#73a5ff",
  baseline: "#b18cff",
  validation: "#dc8cff",
  discovery: "#ff796b",
  unclassified: "#768295",
};

const elements = Object.fromEntries(
  [
    "development-run", "metric", "roles", "complexity-min", "complexity-max",
    "complexity-label", "search", "reset", "run-kicker", "view-title",
    "view-subtitle", "asof", "kpi-score", "kpi-score-foot", "kpi-strict",
    "kpi-strict-foot", "kpi-safety", "kpi-safety-foot", "kpi-evidence",
    "kpi-evidence-foot", "role-legend", "trend-chart", "role-chart",
    "scatter-chart", "scatter-count", "category-profile", "table-count",
    "trial-table", "footer-counts", "tooltip", "site-select", "site-summary",
    "site-comparison", "site-history-title", "site-history-count", "site-trend-chart",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  data: null,
  developmentRunId: "all",
  metric: "overall",
  roles: new Set(),
  complexityMin: 0,
  complexityMax: 100,
  search: "",
  siteId: null,
};

function roleColor(role) {
  return ROLE_COLORS[role] || ROLE_COLORS.unclassified;
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function mean(values) {
  const usable = values.filter(finite).map(Number);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function formatScore(value, digits = 1) {
  return finite(value) ? Number(value).toFixed(digits) : "—";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scoreClass(value) {
  if (!finite(value)) return "";
  if (Number(value) >= 95) return "score-good";
  if (Number(value) >= 75) return "score-mid";
  return "score-low";
}

function labelForMetric() {
  return state.data.metricDefinitions.find((metric) => metric.id === state.metric)?.label || state.metric;
}

function matchesRun(row) {
  return state.developmentRunId === "all" || row.developmentRunId === state.developmentRunId;
}

function matchesRole(row) {
  return state.roles.has(row.role || "unclassified");
}

function matchesComplexity(row) {
  return !finite(row.complexity ?? row.complexityMean) || (
    Number(row.complexity ?? row.complexityMean) >= state.complexityMin &&
    Number(row.complexity ?? row.complexityMean) <= state.complexityMax
  );
}

function matchesSearch(trial) {
  if (!state.search) return true;
  const haystack = [trial.scenarioKey, trial.candidate, trial.role, ...(trial.features || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.search);
}

function filteredTrials() {
  return state.data.trials.filter(
    (trial) => matchesRun(trial) && matchesRole(trial) && matchesComplexity(trial) && matchesSearch(trial),
  );
}

function filteredExperiments(trials) {
  const allowed = new Set(trials.map((trial) => trial.experimentId));
  return state.data.experiments.filter(
    (experiment) => allowed.has(experiment.id) && matchesRun(experiment) && matchesRole(experiment),
  );
}

function metricForExperiment(experiment, trials) {
  if (finite(experiment.metrics?.[state.metric])) return experiment.metrics[state.metric];
  return mean(
    trials
      .filter((trial) => trial.experimentId === experiment.id)
      .map((trial) => trial.metrics?.[state.metric]),
  );
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function showTooltip(event, title, lines) {
  elements.tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong>${lines
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("")}`;
  elements.tooltip.hidden = false;
  const x = Math.min(window.innerWidth - 340, event.clientX + 13);
  const y = Math.min(window.innerHeight - 120, event.clientY + 13);
  elements.tooltip.style.left = `${Math.max(8, x)}px`;
  elements.tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  elements.tooltip.hidden = true;
}

function weightedExperimentMetric(experiments, metric) {
  const rows = experiments.filter((experiment) => finite(experiment.metrics?.[metric]));
  const weight = rows.reduce((sum, experiment) => sum + experiment.validTrials, 0);
  return weight
    ? rows.reduce((sum, experiment) => sum + experiment.metrics[metric] * experiment.validTrials, 0) / weight
    : null;
}

function renderKpis(trials, experiments) {
  const fullComplexity =
    state.complexityMin === state.data.summary.complexityMin &&
    state.complexityMax === state.data.summary.complexityMax;
  const wholeExperiments = !state.search && fullComplexity;
  const valid = trials.filter((trial) => !trial.infrastructureInvalid);
  const selected = wholeExperiments && !state.metric.startsWith("check:")
    ? weightedExperimentMetric(experiments, state.metric)
    : mean(valid.map((trial) => trial.metrics?.[state.metric]));
  const strict = wholeExperiments
    ? Math.round(experiments.reduce((sum, experiment) => sum + (experiment.metrics.strict / 100) * experiment.validTrials, 0))
    : valid.filter((trial) => trial.metrics.strict === 100).length;
  const safety = wholeExperiments
    ? Math.round(experiments.reduce((sum, experiment) => sum + (experiment.metrics.safety / 100) * experiment.validTrials, 0))
    : valid.filter((trial) => trial.metrics.safety === 100).length;
  const evidence = wholeExperiments
    ? experiments.reduce((sum, experiment) => sum + experiment.validTrials, 0)
    : valid.length;
  const invalid = wholeExperiments
    ? experiments.reduce((sum, experiment) => sum + experiment.invalidTrials, 0)
    : trials.length - valid.length;
  elements["kpi-score"].textContent = formatScore(selected, 2);
  elements["kpi-score-foot"].textContent = labelForMetric();
  elements["kpi-strict"].textContent = evidence ? `${strict}/${evidence}` : "—";
  elements["kpi-strict-foot"].textContent = evidence ? `${formatScore((strict / evidence) * 100)}% of valid trials` : "No valid trials";
  elements["kpi-safety"].textContent = evidence ? `${safety}/${evidence}` : "—";
  elements["kpi-safety-foot"].textContent = evidence ? `${formatScore((safety / evidence) * 100)}% of valid trials` : "No valid trials";
  elements["kpi-evidence"].textContent = String(evidence);
  elements["kpi-evidence-foot"].textContent = `${invalid} invalid · ${new Set(trials.map((trial) => trial.scenarioKey)).size} unique tests`;
}

function axis(svg, width, height, margin, { xMin, xMax, yMin = 0, yMax = 100, xLabels = [] }) {
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (value) => margin.left + ((value - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const y = (value) => margin.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * plotHeight;
  for (const tick of [0, 25, 50, 75, 100]) {
    svg.append(svgElement("line", { x1: margin.left, y1: y(tick), x2: width - margin.right, y2: y(tick), class: "grid-line" }));
    const label = svgElement("text", { x: margin.left - 8, y: y(tick) + 3, "text-anchor": "end", class: "axis-label" });
    label.textContent = tick;
    svg.append(label);
  }
  for (const item of xLabels) {
    const label = svgElement("text", { x: x(item.value), y: height - 7, "text-anchor": "middle", class: "axis-label" });
    label.textContent = item.label;
    svg.append(label);
  }
  return { x, y, plotWidth, plotHeight };
}

function renderTrend(experiments, trials) {
  const root = elements["trend-chart"];
  root.replaceChildren();
  const points = experiments
    .map((experiment, index) => ({
      experiment,
      value: metricForExperiment(experiment, trials),
      xValue: state.developmentRunId === "all" ? index + 1 : experiment.sequence ?? index + 1,
    }))
    .filter((point) => finite(point.value));
  if (!points.length) {
    root.innerHTML = '<div class="empty">No experiment scores match this view.</div>';
    return;
  }
  const width = 900;
  const height = 275;
  const margin = { top: 14, right: 17, bottom: 30, left: 42 };
  const xValues = points.map((point) => point.xValue);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
  const labelPoints = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0);
  const scales = axis(svg, width, height, margin, {
    xMin,
    xMax,
    xLabels: labelPoints.map((point) => ({
      value: point.xValue,
      label: state.developmentRunId === "all" ? String(point.xValue) : `#${point.xValue}`,
    })),
  });
  const pathData = points
    .map((point, index) => `${index ? "L" : "M"}${scales.x(point.xValue)},${scales.y(point.value)}`)
    .join(" ");
  svg.append(svgElement("path", { d: pathData, class: "trend-path" }));
  for (const point of points) {
    const color = roleColor(point.experiment.role);
    const circle = svgElement("circle", {
      cx: scales.x(point.xValue),
      cy: scales.y(point.value),
      r: 5.5,
      fill: color,
      stroke: "#111720",
      "stroke-width": 2,
      class: "trend-point",
    });
    circle.addEventListener("pointermove", (event) => showTooltip(event, point.experiment.candidate, [
      `${labelForMetric()}: ${formatScore(point.value, 2)}`,
      `${point.experiment.role} · ${point.experiment.validTrials} valid trials`,
      point.experiment.batchId || point.experiment.id,
    ]));
    circle.addEventListener("pointerleave", hideTooltip);
    svg.append(circle);
  }
  root.append(svg);
}

function renderRoleChart(trials, experiments) {
  const root = elements["role-chart"];
  root.replaceChildren();
  const rows = [...state.roles].map((role) => {
    const roleTrials = trials.filter((trial) => trial.role === role);
    const roleExperiments = experiments.filter((experiment) => experiment.role === role);
    const value = state.metric.startsWith("check:")
      ? mean(roleTrials.map((trial) => trial.metrics?.[state.metric]))
      : weightedExperimentMetric(roleExperiments, state.metric);
    return { role, count: roleTrials.length, value };
  }).filter((row) => row.count > 0);
  if (!rows.length) {
    root.innerHTML = '<div class="empty">No batch roles match this view.</div>';
    return;
  }
  for (const row of rows) {
    const element = document.createElement("div");
    element.className = "role-row";
    element.style.setProperty("--role-color", roleColor(row.role));
    element.innerHTML = `
      <div class="role-meta"><strong>${escapeHtml(row.role)}</strong><span>${formatScore(row.value, 2)}</span></div>
      <div class="role-track"><div class="role-fill" style="width:${Math.max(0, Math.min(100, row.value || 0))}%"></div></div>
      <div class="role-caption">${row.count} scored trial${row.count === 1 ? "" : "s"}</div>`;
    root.append(element);
  }
}

function renderScatter(trials) {
  const root = elements["scatter-chart"];
  root.replaceChildren();
  const points = trials.filter((trial) => finite(trial.complexity) && finite(trial.metrics?.[state.metric]));
  elements["scatter-count"].textContent = `${points.length} trial${points.length === 1 ? "" : "s"}`;
  if (!points.length) {
    root.innerHTML = '<div class="empty">No complexity-linked trials match this view.</div>';
    return;
  }
  const width = 900;
  const height = 272;
  const margin = { top: 13, right: 17, bottom: 32, left: 42 };
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
  const min = Math.min(...points.map((point) => point.complexity));
  const max = Math.max(...points.map((point) => point.complexity));
  const steps = [...new Set([min, Math.round((min + max) / 2), max])];
  const scales = axis(svg, width, height, margin, {
    xMin: Math.min(min, max - 1),
    xMax: Math.max(max, min + 1),
    xLabels: steps.map((value) => ({ value, label: String(value) })),
  });
  for (const point of points) {
    const circle = svgElement("circle", {
      cx: scales.x(point.complexity),
      cy: scales.y(point.metrics[state.metric]),
      r: point.infrastructureInvalid ? 3 : 5,
      fill: roleColor(point.role),
      "fill-opacity": 0.74,
      stroke: point.metrics.safety === 100 ? "rgba(255,255,255,.35)" : "#ff796b",
      "stroke-width": point.metrics.safety === 100 ? 1 : 2.5,
      class: "scatter-point",
    });
    circle.addEventListener("pointermove", (event) => showTooltip(event, point.scenarioKey, [
      `${labelForMetric()}: ${formatScore(point.metrics[state.metric], 2)}`,
      `Complexity ${point.complexity} · ${point.role}`,
      `${point.status} · ${point.candidate}`,
    ]));
    circle.addEventListener("pointerleave", hideTooltip);
    svg.append(circle);
  }
  root.append(svg);
}

function renderCategoryProfile(trials) {
  const root = elements["category-profile"];
  root.replaceChildren();
  for (const category of state.data.categoryDefinitions) {
    const values = trials.map((trial) => trial.metrics[category.id]).filter(finite);
    const value = mean(values);
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `
      <label>${escapeHtml(category.shortLabel)}</label>
      <div class="category-bar"><span style="width:${Math.max(0, Math.min(100, value || 0))}%"></span></div>
      <output>${formatScore(value)}</output>
      <div class="category-detail">${values.length} comparable trial${values.length === 1 ? "" : "s"}</div>`;
    root.append(row);
  }
}

function aggregateSites(trials) {
  const groups = new Map();
  for (const trial of trials.filter((row) => !row.infrastructureInvalid)) {
    if (!groups.has(trial.siteId)) groups.set(trial.siteId, []);
    groups.get(trial.siteId).push(trial);
  }
  return [...groups.entries()].map(([siteId, rows]) => ({
    siteId,
    rows,
    scenarios: new Set(rows.map((row) => row.scenarioId)).size,
    experiments: new Set(rows.map((row) => row.experimentId)).size,
    complexity: mean(rows.map((row) => row.complexity)),
    value: mean(rows.map((row) => row.metrics?.[state.metric])),
  })).filter((row) => finite(row.value));
}

function renderSiteComparison(trials) {
  const root = elements["site-comparison"];
  const rows = aggregateSites(trials).sort((left, right) => right.value - left.value || left.siteId.localeCompare(right.siteId));
  const selected = rows.find((row) => row.siteId === state.siteId);
  const rank = selected ? rows.indexOf(selected) + 1 : null;
  const percentile = selected && rows.length > 1
    ? ((rows.length - rank) / (rows.length - 1)) * 100
    : selected ? 100 : null;
  elements["site-summary"].innerHTML = `
    <div class="site-stat"><span>${escapeHtml(labelForMetric())}</span><strong>${formatScore(selected?.value, 2)}</strong></div>
    <div class="site-stat"><span>Corpus rank</span><strong>${rank ? `#${rank}/${rows.length}` : "—"}</strong></div>
    <div class="site-stat"><span>Percentile</span><strong>${finite(percentile) ? `${formatScore(percentile, 0)}th` : "—"}</strong></div>`;
  if (!rows.length) {
    root.innerHTML = '<div class="empty">No site aggregates match this view.</div>';
    return;
  }
  root.innerHTML = rows.map((row) => `
    <div class="site-row ${row.siteId === state.siteId ? "is-selected" : ""}">
      <label title="${escapeHtml(row.siteId)}">${escapeHtml(row.siteId)}</label>
      <div class="site-bar"><span style="width:${Math.max(0, Math.min(100, row.value))}%;--bar-color:${row.siteId === state.siteId ? "var(--amber)" : "var(--faint)"}"></span></div>
      <output>${formatScore(row.value)}</output>
    </div>`).join("");
  const selectedElement = root.querySelector(".is-selected");
  selectedElement?.scrollIntoView({ block: "nearest" });
}

function renderSiteTrend(trials, experiments) {
  const root = elements["site-trend-chart"];
  root.replaceChildren();
  elements["site-history-title"].textContent = state.siteId
    ? `${state.siteId} over time`
    : "Score over time";
  const selected = trials.filter(
    (trial) => trial.siteId === state.siteId && !trial.infrastructureInvalid,
  );
  const groups = new Map();
  for (const trial of selected) {
    if (!groups.has(trial.experimentId)) groups.set(trial.experimentId, []);
    groups.get(trial.experimentId).push(trial);
  }
  const points = [...groups.entries()].map(([experimentId, rows]) => {
    const experiment = experiments.find((row) => row.id === experimentId) ||
      state.data.experiments.find((row) => row.id === experimentId);
    return {
      experiment,
      value: mean(rows.map((row) => row.metrics?.[state.metric])),
      trials: rows.length,
    };
  }).filter((point) => point.experiment && finite(point.value))
    .sort((left, right) => String(left.experiment.completedAt || "").localeCompare(String(right.experiment.completedAt || "")));
  elements["site-history-count"].textContent = `${points.length} measured experiment${points.length === 1 ? "" : "s"}`;
  if (!points.length) {
    root.innerHTML = '<div class="empty">This site has no measurements in the current view.</div>';
    return;
  }
  const width = 900;
  const height = 280;
  const margin = { top: 13, right: 17, bottom: 32, left: 42 };
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" });
  const scales = axis(svg, width, height, margin, {
    xMin: 1,
    xMax: Math.max(2, points.length),
    xLabels: points.map((point, index) => ({
      value: index + 1,
      label: point.experiment.sequence ? `#${point.experiment.sequence}` : String(index + 1),
    })).filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0),
  });
  const pathData = points.map((point, index) => `${index ? "L" : "M"}${scales.x(index + 1)},${scales.y(point.value)}`).join(" ");
  svg.append(svgElement("path", { d: pathData, class: "trend-path" }));
  for (const [index, point] of points.entries()) {
    const circle = svgElement("circle", {
      cx: scales.x(index + 1),
      cy: scales.y(point.value),
      r: 5.5,
      fill: roleColor(point.experiment.role),
      stroke: "#111720",
      "stroke-width": 2,
      class: "trend-point",
    });
    circle.addEventListener("pointermove", (event) => showTooltip(event, state.siteId, [
      `${labelForMetric()}: ${formatScore(point.value, 2)}`,
      `${point.experiment.role} · ${point.experiment.candidate}`,
      new Date(point.experiment.completedAt).toLocaleString(),
    ]));
    circle.addEventListener("pointerleave", hideTooltip);
    svg.append(circle);
  }
  root.append(svg);
}

function renderTable(trials) {
  const sorted = [...trials].sort((left, right) =>
    String(right.completedAt || "").localeCompare(String(left.completedAt || "")) ||
    right.scenarioKey.localeCompare(left.scenarioKey),
  );
  const visible = sorted.slice(0, 300);
  elements["table-count"].textContent = sorted.length > visible.length
    ? `Showing ${visible.length} of ${sorted.length}`
    : `${sorted.length} trial${sorted.length === 1 ? "" : "s"}`;
  elements["trial-table"].innerHTML = visible.map((trial) => {
    const cells = ["overall", "structure_semantics", "journey_behavior", "execution_capture", "safety_privacy"]
      .map((metric) => `<td class="${scoreClass(trial.metrics[metric])}">${formatScore(trial.metrics[metric])}</td>`)
      .join("");
    return `<tr>
      <td><span class="test-name" title="${escapeHtml(trial.scenarioKey)}">${escapeHtml(trial.scenarioKey)}</span><span class="test-features">${escapeHtml((trial.features || []).join(" · ") || trial.candidate)}</span></td>
      <td><span class="batch-label" style="--role-color:${roleColor(trial.role)}">${escapeHtml(trial.role)}</span></td>
      <td>${finite(trial.complexity) ? trial.complexity : "—"}</td>
      ${cells}
      <td><span class="status status-${escapeHtml(trial.status)}">${escapeHtml(trial.status)}</span></td>
    </tr>`;
  }).join("");
}

function renderLegend() {
  elements["role-legend"].innerHTML = [...state.roles].map((role) =>
    `<span style="--legend-color:${roleColor(role)}"><i></i>${escapeHtml(role)}</span>`,
  ).join("");
}

function renderHeader(trials, experiments) {
  const selectedRun = state.data.developmentRuns.find((run) => run.id === state.developmentRunId);
  elements["run-kicker"].textContent = selectedRun ? "Development run" : "All measured history";
  elements["view-title"].textContent = selectedRun?.name || "Performance across the corpus";
  elements["view-subtitle"].textContent = selectedRun?.assessment?.detail ||
    `${experiments.length} experiments and ${trials.length} scored trials match the current evidence view.`;
  elements.asof.textContent = `Registry ${new Date(state.data.registryGeneratedAt || state.data.generatedAt).toLocaleString()}`;
  elements["footer-counts"].textContent = `${state.data.summary.experiments} experiments · ${state.data.summary.batches} batches · ${state.data.summary.trials} trial records`;
}

function render() {
  const trials = filteredTrials();
  const experiments = filteredExperiments(trials);
  elements["complexity-label"].textContent = `${state.complexityMin}–${state.complexityMax}`;
  renderHeader(trials, experiments);
  renderKpis(trials, experiments);
  renderLegend();
  renderTrend(experiments, trials);
  renderRoleChart(trials, experiments);
  renderScatter(trials);
  renderCategoryProfile(trials);
  renderSiteComparison(trials);
  renderSiteTrend(trials, experiments);
  renderTable(trials);
}

function populateControls() {
  const runs = [...state.data.developmentRuns].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  elements["development-run"].innerHTML = [
    '<option value="all">All recorded history</option>',
    ...runs.map((run) => `<option value="${escapeHtml(run.id)}">${escapeHtml(run.name)}</option>`),
  ].join("");
  state.developmentRunId = runs[0]?.id || "all";
  elements["development-run"].value = state.developmentRunId;

  const sites = [...state.data.sites].sort(
    (left, right) => right.experiments - left.experiments || left.siteId.localeCompare(right.siteId),
  );
  elements["site-select"].innerHTML = sites.map((site) =>
    `<option value="${escapeHtml(site.siteId)}">${escapeHtml(site.siteId)}</option>`,
  ).join("");
  state.siteId = sites[0]?.siteId || null;
  elements["site-select"].value = state.siteId || "";

  const core = state.data.metricDefinitions.filter((metric) => metric.scope !== "check");
  const checks = state.data.metricDefinitions.filter((metric) => metric.scope === "check");
  elements.metric.innerHTML = `
    <optgroup label="Composite and categories">${core.map((metric) => `<option value="${escapeHtml(metric.id)}">${escapeHtml(metric.label)}</option>`).join("")}</optgroup>
    <optgroup label="Individual scored checks">${checks.map((metric) => `<option value="${escapeHtml(metric.id)}">${escapeHtml(metric.shortLabel)}</option>`).join("")}</optgroup>`;

  state.roles = new Set(state.data.roles);
  elements.roles.innerHTML = state.data.roles.map((role) => `
    <label class="role-chip" style="--role-color:${roleColor(role)}">
      <input type="checkbox" value="${escapeHtml(role)}" checked />
      <span>${escapeHtml(role)}</span>
    </label>`).join("");

  const min = state.data.summary.complexityMin;
  const max = state.data.summary.complexityMax;
  state.complexityMin = min;
  state.complexityMax = max;
  for (const input of [elements["complexity-min"], elements["complexity-max"]]) {
    input.min = min;
    input.max = max;
    input.step = 1;
  }
  elements["complexity-min"].value = min;
  elements["complexity-max"].value = max;
}

function bindControls() {
  elements["development-run"].addEventListener("change", (event) => {
    state.developmentRunId = event.target.value;
    render();
  });
  elements.metric.addEventListener("change", (event) => {
    state.metric = event.target.value;
    render();
  });
  elements["site-select"].addEventListener("change", (event) => {
    state.siteId = event.target.value;
    render();
  });
  elements.roles.addEventListener("change", (event) => {
    if (event.target.checked) state.roles.add(event.target.value);
    else state.roles.delete(event.target.value);
    render();
  });
  const updateComplexity = () => {
    const low = Number(elements["complexity-min"].value);
    const high = Number(elements["complexity-max"].value);
    state.complexityMin = Math.min(low, high);
    state.complexityMax = Math.max(low, high);
    render();
  };
  elements["complexity-min"].addEventListener("input", updateComplexity);
  elements["complexity-max"].addEventListener("input", updateComplexity);
  elements.search.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });
  elements.reset.addEventListener("click", () => {
    state.developmentRunId = "all";
    state.metric = "overall";
    state.roles = new Set(state.data.roles);
    state.complexityMin = state.data.summary.complexityMin;
    state.complexityMax = state.data.summary.complexityMax;
    state.search = "";
    elements["development-run"].value = "all";
    elements.metric.value = "overall";
    elements.search.value = "";
    elements["complexity-min"].value = state.complexityMin;
    elements["complexity-max"].value = state.complexityMax;
    for (const checkbox of elements.roles.querySelectorAll("input")) checkbox.checked = true;
    render();
  });
  window.addEventListener("resize", hideTooltip);
}

async function start() {
  const response = await fetch("/api/dashboard-data", { cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard data request failed: ${response.status}`);
  state.data = await response.json();
  populateControls();
  bindControls();
  render();
}

start().catch((error) => {
  console.error(error);
  document.querySelector("main").innerHTML = `<div class="empty">Unable to load evaluation artifacts: ${escapeHtml(error.message)}</div>`;
});
