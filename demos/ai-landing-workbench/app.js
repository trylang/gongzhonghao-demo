// AI 落地三镜工作台 · 前端逻辑（三镜）
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- 场景模板（第一镜） ----------
  const SCENE_TEMPLATES = {
    huangjiu: {
      businessType: "区域黄酒 / 农产品品牌",
      businessDesc: "有产地和老工艺，主要卖给本地和送礼人群，想破圈到年轻人",
      painPoints: ["获客", "复购"], resources: ["老客名单", "品牌口碑", "行业 know-how"],
      futureGoals: ["做品牌", "营收翻倍"], monthlyBudget: "1000–5000 元",
      avoidAI: ["定价", "内容口径"], successMetrics: ["营收", "复购率"],
    },
    bakery: {
      businessType: "社区烘焙 / 连锁餐饮",
      businessDesc: "2-3 家社区店，靠熟客和外卖，高峰期出餐和私域复购是痛点",
      painPoints: ["复购", "获客", "人力"], resources: ["私域社群", "老客名单", "内容素材"],
      futureGoals: ["开分店", "少雇人"], monthlyBudget: "1000–5000 元",
      avoidAI: ["客户沟通"], successMetrics: ["营收", "人力节省"],
    },
    edu: {
      businessType: "少儿教培 / 知识服务",
      businessDesc: "小班课 + 线上社群，获客靠转介绍，续费是生命线",
      painPoints: ["获客", "复购"], resources: ["老客名单", "内容素材", "私域社群"],
      futureGoals: ["标准化可复制", "营收翻倍"], monthlyBudget: "1000–5000 元",
      avoidAI: ["内容口径", "客户沟通"], successMetrics: ["客户数", "复购率"],
    },
    factory: {
      businessType: "小型制造 / 加工厂",
      businessDesc: "接单生产，依赖老板跑业务和大客户，报价和排产靠经验",
      painPoints: ["获客", "供应链", "人力"], resources: ["供应链优势", "行业 know-how", "渠道关系"],
      futureGoals: ["少雇人", "标准化可复制"], monthlyBudget: "5000–2 万",
      avoidAI: ["定价", "财务"], successMetrics: ["利润", "人力节省"],
    },
    travel: {
      businessType: "文旅 / 民宿 / 体验",
      businessDesc: "有内容和场地，淡旺季明显，想做私域复购和周边带货",
      painPoints: ["获客", "复购"], resources: ["内容素材", "品牌口碑", "私域社群"],
      futureGoals: ["做品牌", "营收翻倍"], monthlyBudget: "1000–5000 元",
      avoidAI: ["内容口径"], successMetrics: ["营收", "复购率"],
    },
    service: {
      businessType: "本地生活服务（维修 / 家政 / 美容）",
      businessDesc: "师傅上门服务，靠口碑和微信接单，排期和客户跟进乱",
      painPoints: ["获客", "交付", "人力"], resources: ["老客名单", "私域社群", "品牌口碑"],
      futureGoals: ["少雇人", "标准化可复制"], monthlyBudget: "<1000 元",
      avoidAI: ["客户沟通"], successMetrics: ["人力节省", "客户数"],
    },
  };

  // 第三镜：岗位 → 默认任务模板
  const ROLE_TASKS = {
    "销售": ["线索搜集与初筛", "首次触达/破冰", "方案与报价", "跟进与催单", "老客回访"],
    "客服": ["售前答疑", "工单分派", "常见问题回复", "投诉处理", "满意度回访"],
    "内容运营": ["选题与策划", "文案撰写", "配图/简修", "多平台分发", "数据复盘"],
    "私域运营": ["朋友圈/社群内容", "客户分层打标", "1v1 跟进", "活动触达", "复购提醒"],
    "运营": ["活动策划", "数据看板搭建", "竞品监控", "流程 SOP 整理", "周报月报"],
    "行政": ["日程/会议安排", "文档整理归档", "报销/对账", "合同管理", "邮件往来"],
  };

  const state = { vision: null, loop: null, rep: null };

  // ============ 通用工具 ============
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function setChecks(sel, vals) {
    $$(sel + " input[type=checkbox]").forEach((cb) => { cb.checked = cb.value === "__other" ? false : vals.includes(cb.value); });
  }
  function setRadio(sel, val) {
    const r = $$(sel + " input[type=radio]").find((x) => x.value === val); if (r) r.checked = true;
  }
  function collectChecks(sel, otherId) {
    const out = [];
    $$(sel + " input[type=checkbox]").forEach((cb) => {
      if (cb.value === "__other") { const txt = $("#" + otherId).value.trim(); if (cb.checked && txt) out.push(txt); }
      else if (cb.checked) out.push(cb.value);
    });
    return out;
  }
  function tagClass(v, prefix) {
    const map = { 高: "high", 中: "mid", 低: "low" };
    const cls = map[(v || "").trim()] || "mid";
    return `<span class="tag ${prefix}-${cls}">${esc(v || "")}</span>`;
  }
  function roleKey(role) {
    const r = (role || "");
    if (r.includes("全自动")) return "auto";
    if (r.includes("辅助")) return "assist";
    if (r.includes("人做")) return "human";
    if (r.includes("暂不动")) return "hold";
    return "mid";
  }
  function repTag(v) {
    const map = { 高: "high", 中: "mid", 低: "low" };
    return `<span class="tag rep-${map[(v || "").trim()] || "mid"}">${esc(v || "")}</span>`;
  }
  async function postJSON(url, payload) {
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "请求失败");
    if (data.parseError) throw new Error("模型未返回标准 JSON，请重试");
    return data.result;
  }
  function showPanel(mirrorSel, prefix, n) {
    const m = $(mirrorSel);
    m.querySelectorAll(".step-dot").forEach((d, i) => d.classList.toggle("active", i + 1 === n));
    [1, 2, 3].forEach((i) => { const p = $("#" + prefix + i); if (p) p.classList.toggle("hidden", i !== n); });
  }
  function copyText(text) {
    try { navigator.clipboard.writeText(text).then(() => alert("已复制，可直接粘贴到文档 / 微信。")); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); alert("已复制。"); }
  }
  function downloadHTML(text, name) {
    const blob = new Blob([`<pre style="font-family:inherit;white-space:pre-wrap;padding:20px">${esc(text)}</pre>`], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  function renderClarify(containerSel, questions) {
    const cq = $(containerSel); cq.innerHTML = "";
    (questions || []).forEach((q, i) => {
      const div = document.createElement("div");
      div.innerHTML = `<label>${i + 1}. ${esc(q)}</label><input type="text" data-q="${esc(q)}" placeholder="你的回答…" />`;
      cq.appendChild(div);
    });
  }
  function collectClarify(containerSel) {
    const clar = {};
    $$(containerSel + " input[type=text]").forEach((inp) => { if (inp.value.trim()) clar[inp.dataset.q] = inp.value.trim(); });
    return clar;
  }

  // ============ 第一镜：Vision ============
  function applyTemplate(key) {
    const t = SCENE_TEMPLATES[key]; if (!t) return;
    $("#businessType").value = t.businessType || "";
    $("#businessDesc").value = t.businessDesc || "";
    setChecks("#painPoints", t.painPoints); setChecks("#resources", t.resources);
    setChecks("#futureGoals", t.futureGoals); setRadio("#monthlyBudget", t.monthlyBudget);
    setChecks("#avoidAI", t.avoidAI); setChecks("#successMetrics", t.successMetrics);
  }
  function collectInput() {
    const budget = ($$("#monthlyBudget input[type=radio]").find((r) => r.checked) || {}).value || "";
    return {
      businessType: $("#businessType").value.trim(), businessDesc: $("#businessDesc").value.trim(),
      painPoints: collectChecks("#painPoints", "painOther"), resources: collectChecks("#resources", "resOther"),
      futureGoals: collectChecks("#futureGoals", "futureOther"), futureText: $("#futureText").value.trim(),
      monthlyBudget: budget, avoidAI: collectChecks("#avoidAI", "avoidOther"),
      successMetrics: collectChecks("#successMetrics", "metricOther"), freeText: $("#freeText").value.trim(),
    };
  }
  function vcard(o) {
    const fly = o.flywheel && /飞轮|能|可/.test(o.flywheel) ? `<span class="tag fly-yes">有飞轮</span>` : `<span class="tag fly-no">弱飞轮</span>`;
    return `<div class="card">
      <h4>${esc(o.title || "")}</h4>
      <div>${tagClass(o.leverage, "lev")} ${tagClass(o.difficulty, "diff")} ${fly}</div>
      <p style="margin:8px 0 0">${esc(o.why || "")}</p>
      ${o.firstMove ? `<p style="margin:6px 0 0;color:var(--accent)">👉 第一步：${esc(o.firstMove)}</p>` : ""}
      ${o.flywheel ? `<p style="margin:6px 0 0;color:var(--muted)">飞轮：${esc(o.flywheel)}</p>` : ""}
    </div>`;
  }
  function renderVisionDraft(r) {
    let html = `<div class="vision-line">${esc(r.visionStatement || "")}</div>`;
    (r.opportunities || []).forEach((o) => { html += vcard(o); });
    if (r.nextStepHint) html += `<p class="hint">下一步建议：${esc(r.nextStepHint)}</p>`;
    $("#draftOut").innerHTML = html;
    renderClarify("#clarifyQuestions", r.clarifyingQuestions);
  }
  function renderVisionBattle(r) {
    let html = `<div class="vision-line">${esc(r.visionStatement || "")}</div>`;
    (r.opportunities || []).forEach((o) => { html += vcard(o); });
    html += `<h3>行动作战图</h3><div class="battle">${esc(r.battleMap || "")}</div>`;
    if (r.metrics) html += `<h3>建议追踪的指标</h3><div class="battle">${esc(r.metrics)}</div>`;
    if (r.nextStepHint) html += `<p class="hint">进入循环镜建议：${esc(r.nextStepHint)}</p>`;
    $("#battleOut").innerHTML = html;
  }
  function visionText(r) {
    let t = "【AI 落地作战图】\n" + "一句话定位：" + (r.visionStatement || "") + "\n\n";
    (r.opportunities || []).forEach((o, i) => {
      t += `${i + 1}. ${o.title}（杠杆 ${o.leverage} / 难度 ${o.difficulty}）\n   为什么：${o.why || ""}\n`;
      if (o.firstMove) t += "   第一步：" + o.firstMove + "\n";
      if (o.flywheel) t += "   飞轮：" + o.flywheel + "\n";
    });
    t += "\n【行动作战图】\n" + (r.battleMap || "");
    if (r.metrics) t += "\n\n【指标】\n" + r.metrics;
    return t;
  }

  // ============ 第二镜：Loop ============
  const DEFAULT_LOOP_NODES = ["获客", "评估", "服务", "交付", "复购"];
  function nodeRow(name) {
    const div = document.createElement("div");
    div.className = "item-row";
    div.innerHTML = `<input class="nn-name" placeholder="节点名" value="${esc(name || "")}" />
      <select class="nn-owner"><option>老板</option><option>员工</option><option>外包</option><option>无人/缺</option></select>
      <input class="nn-daily" placeholder="每天量" />
      <input class="nn-pain" placeholder="卡在哪" />
      <button class="row-del" title="删除">×</button>`;
    div.querySelector(".row-del").addEventListener("click", () => div.remove());
    return div;
  }
  function ensureLoopNodes() {
    const c = $("#loopNodes");
    if (c.children.length) return;
    DEFAULT_LOOP_NODES.forEach((n) => c.appendChild(nodeRow(n)));
  }
  function collectLoopNodes() {
    return $$("#loopNodes .item-row").map((row) => ({
      name: row.querySelector(".nn-name").value.trim(),
      owner: row.querySelector(".nn-owner").value,
      daily: row.querySelector(".nn-daily").value.trim(),
      pain: row.querySelector(".nn-pain").value.trim(),
    })).filter((n) => n.name);
  }
  function nodeFlow(nodes) {
    let h = `<div class="node-flow">`;
    (nodes || []).forEach((n, i) => {
      if (i > 0) h += `<span class="arrow">→</span>`;
      h += `<div class="node role-${roleKey(n.role)}"><div class="node-name">${esc(n.name || "")}</div><span class="tag role-${roleKey(n.role)}">${esc(n.role || "")}</span></div>`;
    });
    h += `</div>`;
    return h;
  }
  function renderLoopDraft(r) {
    let html = `<div class="vision-line">场景：${esc(r.scenario || "")}</div>` + nodeFlow(r.nodes);
    (r.nodes || []).forEach((n) => {
      html += `<div class="card"><h4>${esc(n.name || "")} <span class="tag role-${roleKey(n.role)}">${esc(n.role || "")}</span></h4>
        <p>${esc(n.why || "")}</p>
        <p style="color:var(--muted);font-size:13px">输入：${esc(n.input || "")} ｜ 产出：${esc(n.output || "")}</p>
        ${n.toolHint ? `<p style="color:var(--accent)">🛠 ${esc(n.toolHint)}</p>` : ""}</div>`;
    });
    if (r.loops && r.loops.length) { html += `<h3>数据飞轮</h3>`; r.loops.forEach((l) => html += `<div class="card">${esc(l)}</div>`); }
    if (r.mvp) {
      html += `<h3>最小可行方案（先上这 2 个）</h3><div class="card"><p><strong>${esc((r.mvp.firstNodes || []).join(" + "))}</strong></p><p>${esc(r.mvp.rationale || "")}</p>${r.mvp.quickWin ? `<p style="color:var(--accent)">👉 ${esc(r.mvp.quickWin)}</p>` : ""}</div>`;
    }
    if (r.nextStepHint) html += `<p class="hint">进入显微镜建议：${esc(r.nextStepHint)}</p>`;
    $("#loopDraftOut").innerHTML = html;
    renderClarify("#loopClarifyQuestions", r.clarifyingQuestions);
  }
  function renderLoopBattle(r) {
    let html = `<div class="vision-line">场景：${esc(r.scenario || "")}</div>` + nodeFlow(r.nodes);
    if (r.loops && r.loops.length) { html += `<h3>数据飞轮</h3>`; r.loops.forEach((l) => html += `<div class="card">${esc(l)}</div>`); }
    if (r.mvp) {
      html += `<h3>最小可行方案</h3><div class="card"><p><strong>${esc((r.mvp.firstNodes || []).join(" + "))}</strong></p><p>${esc(r.mvp.rationale || "")}</p>${r.mvp.firstMove ? `<p style="color:var(--accent)">👉 第一步：${esc(r.mvp.firstMove)}</p>` : (r.mvp.quickWin ? `<p style="color:var(--accent)">👉 ${esc(r.mvp.quickWin)}</p>` : "")}</div>`;
    }
    html += `<h3>落地作战图</h3><div class="battle">${esc(r.battleMap || "")}</div>`;
    if (r.metrics) html += `<h3>建议追踪的指标</h3><div class="battle">${esc(r.metrics)}</div>`;
    if (r.nextStepHint) html += `<p class="hint">进入显微镜建议：${esc(r.nextStepHint)}</p>`;
    $("#loopBattleOut").innerHTML = html;
  }
  function loopText(r) {
    let t = "【业务循环作战图】\n场景：" + (r.scenario || "") + "\n\n";
    (r.nodes || []).forEach((n, i) => { t += `${i + 1}. ${n.name}（${n.role}）\n   为什么：${n.why || ""}\n   输入：${n.input || ""} 产出：${n.output || ""}\n   工具：${n.toolHint || ""}\n`; });
    if (r.loops) t += "\n【数据飞轮】\n" + r.loops.map((l, i) => `${i + 1}. ${l}`).join("\n") + "\n";
    if (r.mvp) t += `\n【最小可行方案】先上：${(r.mvp.firstNodes || []).join(" + ")}\n理由：${r.mvp.rationale || ""}\n第一步：${r.mvp.firstMove || r.mvp.quickWin || ""}\n`;
    t += `\n【落地作战图】\n${r.battleMap || ""}`;
    if (r.metrics) t += `\n\n【指标】\n${r.metrics}`;
    return t;
  }

  // ============ 第三镜：Replace ============
  function taskRow(name) {
    const div = document.createElement("div");
    div.className = "item-row";
    div.innerHTML = `<input class="tt-name" placeholder="任务名" value="${esc(name || "")}" />
      <input class="tt-hours" placeholder="月工时h" />
      <button class="row-del" title="删除">×</button>`;
    div.querySelector(".row-del").addEventListener("click", () => div.remove());
    return div;
  }
  function loadRoleTasks(role) {
    const c = $("#repTasks"); c.innerHTML = "";
    (ROLE_TASKS[role] || ROLE_TASKS["私域运营"]).forEach((t) => c.appendChild(taskRow(t)));
  }
  function collectTasks() {
    return $$("#repTasks .item-row").map((row) => ({
      name: row.querySelector(".tt-name").value.trim(),
      hours: row.querySelector(".tt-hours").value.trim(),
    })).filter((t) => t.name);
  }
  function summaryCard(s) {
    return `<div class="summary-card">
      <div><span class="big">${esc(s.replacedRatio || "")}</span><label>任务可替代率</label></div>
      <div><span class="big">${esc(s.totalHoursSaved || "")}h</span><label>每月可省工时</label></div>
      <div><span class="big">${esc(s.agentCostPerMonth || "")}</span><label>搭 agent 月成本</label></div>
      <div><span class="big">${esc(s.humanCostPerMonth || "")}</span><label>现岗位月成本</label></div>
    </div>
    <p class="conclusion">${esc(s.conclusion || "")}</p>`;
  }
  function renderRepDraft(r) {
    let html = `<div class="vision-line">岗位：${esc(r.role || "")}</div>`;
    if (r.summary) html += summaryCard(r.summary);
    html += `<table class="matrix"><thead><tr><th>任务</th><th>可替代</th><th>月省工时</th><th>评测指标</th><th>风险/兜底</th></tr></thead><tbody>`;
    (r.tasks || []).forEach((t) => {
      html += `<tr><td>${esc(t.name || "")}</td><td>${repTag(t.replaceable)}</td><td>${esc(t.hoursSaved || "")}h</td><td>${esc(t.evalMetric || "")}</td><td>${esc(t.risk || "")}</td></tr>`;
    });
    html += `</tbody></table>`;
    if (r.nextStepHint) html += `<p class="hint">${esc(r.nextStepHint)}</p>`;
    $("#repDraftOut").innerHTML = html;
    renderClarify("#repClarifyQuestions", r.clarifyingQuestions);
  }
  function renderRepBattle(r) {
    let html = `<div class="vision-line">岗位：${esc(r.role || "")}</div>`;
    if (r.summary) html += summaryCard(r.summary);
    html += `<table class="matrix"><thead><tr><th>任务</th><th>可替代</th><th>月省工时</th><th>评测指标</th><th>风险/兜底</th></tr></thead><tbody>`;
    (r.tasks || []).forEach((t) => {
      html += `<tr><td>${esc(t.name || "")}</td><td>${repTag(t.replaceable)}</td><td>${esc(t.hoursSaved || "")}h</td><td>${esc(t.evalMetric || "")}</td><td>${esc(t.risk || "")}</td></tr>`;
    });
    html += `</tbody></table>`;
    html += `<h3>落地作战图</h3><div class="battle">${esc(r.battleMap || "")}</div>`;
    if (r.checklist && r.checklist.length) { html += `<h3>落地清单</h3><div class="battle">${r.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}</div>`; }
    if (r.metrics) html += `<h3>建议追踪的指标</h3><div class="battle">${esc(r.metrics)}</div>`;
    $("#repBattleOut").innerHTML = html;
  }
  function repText(r) {
    let t = "【岗位替代作战图】\n岗位：" + (r.role || "") + "\n\n";
    (r.tasks || []).forEach((tk, i) => { t += `${i + 1}. ${tk.name}（替代度 ${tk.replaceable}，月省 ${tk.hoursSaved || "?"}h）\n   为什么：${tk.reason || ""}\n   评测：${tk.evalMetric || ""}\n   风险：${tk.risk || ""}\n`; });
    if (r.summary) { const s = r.summary; t += `\n【成本边界】替代率 ${s.replacedRatio} ｜ 月省 ${s.totalHoursSaved}h ｜ agent月成本 ${s.agentCostPerMonth} ｜ 现岗位 ${s.humanCostPerMonth}\n结论：${s.conclusion}\n`; }
    t += `\n【落地作战图】\n${r.battleMap || ""}`;
    if (r.checklist) t += `\n\n【落地清单】\n` + r.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n");
    if (r.metrics) t += `\n\n【指标】\n${r.metrics}`;
    return t;
  }

  // ============ 第一镜事件 ============
  $("#sceneTemplate").addEventListener("change", (e) => applyTemplate(e.target.value));
  $("#btnDraft").addEventListener("click", async () => {
    const input = collectInput();
    if (!input.businessType && !input.freeText) { alert("至少填一下「你的生意是什么」，或选个场景模板～"); return; }
    state.visionInput = input;
    $("#draftOut").innerHTML = `<div class="loading">⏳ 正在结合 Alexandr Wang 的框架，为你生成机会草稿…</div>`;
    showPanel("#mirror1", "step", 2);
    try {
      const draft = await postJSON("/api/vision", { stage: "draft", input });
      renderVisionDraft(draft); state.vision = draft;
    } catch (err) { $("#draftOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnRefine").addEventListener("click", async () => {
    state.visionInput.clarifications = collectClarify("#clarifyQuestions");
    $("#battleOut").innerHTML = `<div class="loading">⏳ 正在结合你的补充，生成定稿作战图…</div>`;
    showPanel("#mirror1", "step", 3);
    try {
      const final = await postJSON("/api/vision", { stage: "refine", input: state.visionInput, history: state.vision });
      renderVisionBattle(final); state.vision = final;
    } catch (err) { $("#battleOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnBack1").addEventListener("click", () => showPanel("#mirror1", "step", 1));
  $("#btnCopy").addEventListener("click", () => copyText(visionText(state.vision)));
  $("#btnDownload").addEventListener("click", () => downloadHTML(visionText(state.vision), "AI落地作战图.html"));
  $("#btnRestart").addEventListener("click", () => { state.visionInput = null; state.vision = null; showPanel("#mirror1", "step", 1); });

  // ============ 第二镜事件 ============
  $("#btnAddNode").addEventListener("click", () => $("#loopNodes").appendChild(nodeRow("")));
  $("#btnLoopDraft").addEventListener("click", async () => {
    ensureLoopNodes();
    const nodes = collectLoopNodes();
    if (!nodes.length) { alert("至少写 1 个节点～"); return; }
    state.loopInput = { businessType: state.visionInput?.businessType || "", scenario: $("#loopScenario").value.trim(), nodes };
    if (!state.loopInput.scenario) { alert("给这个场景起个名～"); return; }
    $("#loopDraftOut").innerHTML = `<div class="loading">⏳ 正在把这条业务流拆成节点、画飞轮…</div>`;
    showPanel("#mirror2", "loopStep", 2);
    try {
      const draft = await postJSON("/api/loop", { stage: "draft", input: state.loopInput });
      renderLoopDraft(draft); state.loop = draft;
    } catch (err) { $("#loopDraftOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnLoopRefine").addEventListener("click", async () => {
    state.loopInput.clarifications = collectClarify("#loopClarifyQuestions");
    $("#loopBattleOut").innerHTML = `<div class="loading">⏳ 正在结合你的补充，生成定稿循环图…</div>`;
    showPanel("#mirror2", "loopStep", 3);
    try {
      const final = await postJSON("/api/loop", { stage: "refine", input: state.loopInput, history: state.loop });
      renderLoopBattle(final); state.loop = final;
    } catch (err) { $("#loopBattleOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnLoopBack1").addEventListener("click", () => showPanel("#mirror2", "loopStep", 1));
  $("#btnLoopCopy").addEventListener("click", () => copyText(loopText(state.loop)));
  $("#btnLoopDownload").addEventListener("click", () => downloadHTML(loopText(state.loop), "业务循环作战图.html"));
  $("#btnLoopRestart").addEventListener("click", () => { state.loopInput = null; state.loop = null; showPanel("#mirror2", "loopStep", 1); });

  // ============ 第三镜事件 ============
  $("#repRole").addEventListener("change", (e) => { if (e.target.value) loadRoleTasks(e.target.value); });
  $("#btnAddTask").addEventListener("click", () => $("#repTasks").appendChild(taskRow("")));
  $("#btnRepDraft").addEventListener("click", async () => {
    const role = $("#repRole").value || $("#repRoleText").value.trim();
    if (!role) { alert("选个岗位，或自己写一个～"); return; }
    const tasks = collectTasks();
    if (!tasks.length) { alert("至少写 1 个任务～"); return; }
    state.repInput = { businessType: state.visionInput?.businessType || "", role, roleCost: $("#repRoleCost").value.trim(), tasks };
    $("#repDraftOut").innerHTML = `<div class="loading">⏳ 正在逐个任务评估可替代度…</div>`;
    showPanel("#mirror3", "repStep", 2);
    try {
      const draft = await postJSON("/api/replace", { stage: "draft", input: state.repInput });
      renderRepDraft(draft); state.rep = draft;
    } catch (err) { $("#repDraftOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnRepRefine").addEventListener("click", async () => {
    state.repInput.clarifications = collectClarify("#repClarifyQuestions");
    $("#repBattleOut").innerHTML = `<div class="loading">⏳ 正在结合你的补充，生成定稿替代图…</div>`;
    showPanel("#mirror3", "repStep", 3);
    try {
      const final = await postJSON("/api/replace", { stage: "refine", input: state.repInput, history: state.rep });
      renderRepBattle(final); state.rep = final;
    } catch (err) { $("#repBattleOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`; }
  });
  $("#btnRepBack1").addEventListener("click", () => showPanel("#mirror3", "repStep", 1));
  $("#btnRepCopy").addEventListener("click", () => copyText(repText(state.rep)));
  $("#btnRepDownload").addEventListener("click", () => downloadHTML(repText(state.rep), "岗位替代作战图.html"));
  $("#btnRepRestart").addEventListener("click", () => { state.repInput = null; state.rep = null; showPanel("#mirror3", "repStep", 1); });

  // ============ 导航 + 共享上下文预填 ============
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    const m = t.dataset.mirror;
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    ["#mirror1", "#mirror2", "#mirror3"].forEach((s, i) => $(s).classList.toggle("hidden", String(i + 1) !== m));
    if (m === "2") {
      ensureLoopNodes();
      if (state.vision && state.vision.opportunities && state.vision.opportunities.length && !$("#loopScenario").value) {
        $("#loopScenario").value = state.vision.opportunities[0].title || "";
      }
    }
    if (m === "3") {
      if (!$("#repTasks").children.length) loadRoleTasks($("#repRole").value || "");
    }
  }));
})();
