const PACKAGE = {
  brew: ["brew", ["install", "agent-browser"]],
  npm: ["npm", ["install", "-g", "agent-browser"]],
};
const NODE_MAJOR = 22;
const DEPS = ["agent-browser", ["install", "--with-deps"]];
const NPM_ACCESS = /EACCES|EPERM|permission denied/i;

export function nodeMajor(version) {
  const m = /^v?(\d+)(\.|$)/.exec(version ?? "");
  return m ? Number(m[1]) : null;
}

export function commandLine(steps) {
  return steps.map(([command, args]) => [command, ...args].join(" ")).join(" && ");
}

export function needsSudoCheck(os, tools) {
  return os === "Linux" && tools?.root !== true;
}

export function installPlan(os, tools, sudo = false) {
  const linux = os === "Linux";
  const deps = linux && (tools?.root === true || sudo === true);
  const via = tools?.brew ? "brew" : tools?.npm && nodeMajor(tools.node) >= NODE_MAJOR ? "npm" : null;
  if (via) {
    const steps = [PACKAGE[via], deps ? DEPS : ["agent-browser", ["install"]]];
    return { via, steps, command: commandLine(steps), reason: null, hint: linux && !deps ? commandLine([DEPS]) : null };
  }
  const reason = tools?.npm && tools.node
    ? `Homebrew is not on this machine's PATH, and its Node.js ${tools.node} is older than the ${NODE_MAJOR} that agent-browser needs.`
    : `Neither Homebrew nor npm with Node.js ${NODE_MAJOR} or later is on this machine's PATH.`;
  return { via: null, steps: [], command: commandLine([PACKAGE.npm, linux ? DEPS : ["agent-browser", ["install"]]]), reason, hint: null };
}

export function installStep(plan, step) {
  return { status: "installing", via: plan.via, step: step + 1, of: plan.steps.length, label: commandLine([plan.steps[step]]) };
}

export function installFailure(plan, step, error) {
  const access = plan.steps[step][0] === "npm" && NPM_ACCESS.test(error)
    ? " npm cannot write to its global folder. Run the command with sudo, or give npm a folder you own with npm config set prefix ~/.npm-global and add ~/.npm-global/bin to PATH."
    : "";
  return { status: "failed", stage: step === 0 ? "package" : "browser", error: `${commandLine([plan.steps[step]])} failed: ${error}${access}`, command: commandLine(plan.steps.slice(step)) };
}

export function installDone(plan) {
  return { status: "installed", hint: plan.hint };
}

export function outputTail(r, lines = 6) {
  const text = (r?.stderr ?? "").trim() || (r?.stdout ?? "").trim();
  return text ? text.split("\n").slice(-lines).join("\n") : `exit ${r?.code}`;
}

export function settledInstall(state, install) {
  if (!install || install.status === "installing") return install ?? null;
  if (state.kind === "running") return null;
  if (state.kind === "start" && !(install.status === "failed" && install.stage === "browser") && !(install.status === "installed" && install.hint)) return null;
  return install;
}
