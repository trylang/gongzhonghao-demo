// ===== 代州黄酒 · 售后分流台 Demo 前端 =====
// 后端持有 Key，前端以 SSE 流式接收四 Agent 结果，点亮流水线并渲染处理单。

// 与 server.js / kb-default.json 保持一致
const POLICY_VERSION = "huangjiu-default-v1.0";

const $ = (id) => document.getElementById(id);
const runBtn = $("runBtn");
const statusEl = $("status");

// ---------- 知识库视图（来自 /api/kb 或内联 fallback）与人工补充 ----------
let KB_VIEW = null;
const supplements = { policy: "", product: "", voice: "", cases: "" };
const AGENT_NAME = { agent1: "订单事实员", agent2: "政策补偿员", agent3: "客服沟通员", agent4: "独立风控审核员" };

function loadInlineKb() {
  const el = document.getElementById("kb-view-data");
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
}

// 页面加载即读内联 fallback 并渲染标签（无需等网络）
KB_VIEW = loadInlineKb();
if (KB_VIEW) renderKbChips();

// 随后异步获取后端最新视图（可能与内联一致，也可能已更新）
fetch("/api/kb")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (d) { KB_VIEW = d; renderKbChips(); } })
  .catch(() => {/* 内联已兜底，静默忽略 */});

// ---------- 示例数据 ----------
const EXAMPLES = {
  damage_photo: {
    product: "代州黄酒·六年陈（¥68/500ml）", order_status: "已签收", case_type_hint: "damage",
    complaint: "收到外箱压坏了，一瓶漏液，已拍了外箱和瓶身照片。",
    logistics: "物流显示已签收，外箱有明显挤压变形。", history: "首次联系，此前无售后。",
  },
  leak_nophoto: {
    product: "代州黄酒·礼盒装（¥158/2瓶）", order_status: "已签收", case_type_hint: "damage",
    complaint: "打开发现一瓶轻了，怀疑漏了，但还没拍照。",
    logistics: "已签收两天，外箱看着正常。", history: "客户要求直接全额退款。",
  },
  logistics: {
    product: "代州黄酒·十年陈（¥128/500ml）", order_status: "运输中", case_type_hint: "logistics",
    complaint: "说明天就要办婚宴要用酒，但物流三天没更新了，很着急。",
    logistics: "物流轨迹停滞已 3 天，无新节点。", history: "首次联系。",
  },
  taste: {
    product: "代州黄酒·六年陈（¥68/500ml）", order_status: "已签收", case_type_hint: "taste",
    complaint: "喝起来和短视频里讲的不一样，太冲了，不像陈酿。",
    logistics: "已签收 4 天，已开封半瓶。", history: "首次联系。",
  },
  wrongship: {
    product: "代州黄酒·礼盒装（¥158/2瓶）", order_status: "已签收", case_type_hint: "wrongship",
    complaint: "我下单的是礼盒两瓶，收到只有一瓶，少发了一瓶。",
    logistics: "已签收，外箱封口完整。", history: "首次联系，有开箱照片。",
  },
  safety: {
    product: "代州黄酒·坛装（¥198/1.5L）", order_status: "已签收", case_type_hint: "other",
    complaint: "喝完肚子疼，怀疑酒有问题，要求赔偿。",
    logistics: "已签收一周。", history: "客户情绪较激动。",
  },
};

document.querySelectorAll(".ex").forEach((b) => {
  b.addEventListener("click", () => {
    const ex = EXAMPLES[b.dataset.ex];
    if (!ex) return;
    $("product").value = ex.product;
    $("order_status").value = ex.order_status;
    $("case_type_hint").value = ex.case_type_hint;
    $("complaint").value = ex.complaint;
    $("logistics_sel").value = "";      // 示例直接填文本框，下拉回到"自定义"
    $("logistics").value = ex.logistics;
    $("history_sel").value = "";
    $("history").value = ex.history;
  });
});

// ---------- SSE 解析 ----------
async function* parseSSE(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = {};
      chunk.split("\n").forEach((line) => {
        if (line.startsWith("event:")) ev.event = line.slice(6).trim();
        else if (line.startsWith("data:")) ev.data = (ev.data ? ev.data + "\n" : "") + line.slice(5).trim();
      });
      if (ev.event && ev.data) {
        try { yield { event: ev.event, data: JSON.parse(ev.data) }; }
        catch { /* 忽略坏帧 */ }
      }
    }
  }
}

// ---------- 流水线节点状态 ----------
function setNode(id, state, summary = "") {
  const n = $(id);
  n.dataset.state = state;
  if (summary) n.querySelector(".node-sum").textContent = summary;
}
function resetNodes() {
  ["node-agent1", "node-agent2", "node-agent3", "node-agent4"].forEach((id) => setNode(id, "idle", ""));
}

// 合并"下拉快捷选 + 文本框自填"：选了下拉则作为前缀，文本为补充
function mergeField(selId, txtId) {
  const s = $(selId).value.trim();
  const t = $(txtId).value.trim();
  if (s && t) return s + "；" + t;
  return s || t;
}

// ---------- 主流程 ----------
async function run() {
  const payload = {
    product: $("product").value,
    order_status: $("order_status").value,
    case_type_hint: $("case_type_hint").value,
    complaint: $("complaint").value.trim(),
    logistics: mergeField("logistics_sel", "logistics"),
    history: mergeField("history_sel", "history"),
    custom_rules: $("custom_rules").value.trim(),
    supplements,
  };
  if (!payload.complaint) { statusEl.textContent = "请先填写客诉内容。"; statusEl.style.color = "var(--red)"; return; }

  runBtn.disabled = true;
  resetNodes();
  $("sheet").className = "sheet empty";
  $("sheet").innerHTML = `<div class="placeholder">AI 正在处理…四 Agent 将依次点亮。</div>`;
  statusEl.textContent = "正在调用 MiniMax-Text-01，四 Agent 顺序执行…";
  statusEl.style.color = "var(--ink-soft)";

  let resp;
  try {
    resp = await fetch("/api/analyze-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    statusEl.textContent = "网络错误：" + e.message; statusEl.style.color = "var(--red)"; runBtn.disabled = false; return;
  }
  if (!resp.ok) {
    statusEl.textContent = "服务端异常（HTTP " + resp.status + "）"; statusEl.style.color = "var(--red)"; runBtn.disabled = false; return;
  }

  let lastEscalated = false;
  try {
    for await (const ev of parseSSE(resp)) {
      if (ev.event === "standardized") {
        statusEl.textContent = "① 案件已标准化，开始 Agent 1…";
        setNode("node-agent1", "active");
      } else if (ev.event === "agent1") {
        setNode("node-agent1", "done", `${ev.data.case_type || ""} · 置信度${ev.data.confidence ?? "?"}`);
        setNode("node-agent2", "active");
        statusEl.textContent = "② 政策补偿员分析中…";
      } else if (ev.event === "agent2") {
        const a = ev.data;
        setNode("node-agent2", a.eligibility === "escalate" ? "escalate" : "done",
          `${a.eligibility === "escalate" ? "升级" : (a.primary_recommendation?.action || "")}`);
        setNode("node-agent3", "active");
        statusEl.textContent = "③ 客服沟通员撰写回复…";
      } else if (ev.event === "agent3") {
        setNode("node-agent3", "done", ev.data.reply_stage || "");
        setNode("node-agent4", "active");
        statusEl.textContent = "④ 独立风控审核中…";
      } else if (ev.event === "agent4") {
        const v = ev.data.verdict;
        setNode("node-agent4", v === "pass" ? "done" : (v === "escalate" ? "escalate" : "done"),
          `${v} · ${ev.data.score ?? "?"}分`);
        statusEl.textContent = "审核完成，生成处理单…";
      } else if (ev.event === "revise") {
        statusEl.textContent = `④ 审核要求返工（第 ${ev.data.round} 轮）：${(ev.data.fixes || []).join("；")}`;
        setNode("node-agent2", "active");
      } else if (ev.event === "final") {
        lastEscalated = ev.data.escalated;
        renderSheet(ev.data.sheet);
      } else if (ev.event === "error") {
        $("sheet").className = "sheet";
        $("sheet").innerHTML = `<div class="placeholder" style="color:var(--red)">⚠️ ${ev.data.message}</div>`;
        statusEl.textContent = "处理中断。"; statusEl.style.color = "var(--red)";
      }
    }
  } catch (e) {
    statusEl.textContent = "流式读取失败：" + e.message; statusEl.style.color = "var(--red)";
  }

  runBtn.disabled = false;
  if (!lastEscalated) {
    statusEl.textContent = lastEscalated === false ? "✅ 处理单已生成（含独立风控放行）。最后那一下由你确认。" : statusEl.textContent;
    statusEl.style.color = "var(--green)";
  } else {
    statusEl.textContent = "🔺 本单已升级人工，处理单标注为需主管确认。";
    statusEl.style.color = "var(--red)";
  }
}

// ---------- 渲染处理单 ----------
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderSheet(sh) {
  const r = sh.recommendation, rp = sh.reply, rv = sh.review;
  const verdictTag = rv.verdict === "pass"
    ? `<span class="sh-tag tag-pass">风控放行</span>`
    : `<span class="sh-tag tag-escalate">${rv.verdict === "escalate" ? "强制升级" : "需返工/升级"}</span>`;
  const approvalTag = r.approval ? `<span class="sh-tag tag-approval">需主管审批</span>` : "";
  const citedHtml = (r.cited || []).map((c) =>
    `<div class="sh-cited">依据：${esc(c.rule_id)}（${esc(c.version)}）— ${esc((c.fragment || "").slice(0, 70))}</div>`).join("") || `<div class="sh-cited">（无规则引用）</div>`;
  const checksHtml = (rv.checks || []).map((c) =>
    `<li>${c.status === "pass" ? "✅" : "❌"} <b>${esc(c.name)}</b>：${esc(c.reason || "")}${c.evidence ? " 〔证据：" + esc(c.evidence) + "〕" : ""}</li>`).join("") || "<li>（无）</li>";

  $("sheet").className = "sheet";
  $("sheet").innerHTML = `
    <div class="sh-section">
      <h3>一、案件摘要 ${verdictTag} ${approvalTag}</h3>
      <div>${esc(sh.caseSummary || "（无）")}</div>
      <div class="sh-meta">类型：${esc(sh.caseType)} ｜ 紧急度：${esc(sh.urgency)} ｜ 置信度：${sh.confidence ?? "?"} ｜ 规则版本：${esc(POLICY_VERSION)}</div>
    </div>

    <div class="sh-section">
      <h3>二、核查事实（订单事实员）</h3>
      <ul class="sh-list">${(sh.facts || []).map((f) => `<li>${esc(f)}</li>`).join("") || "<li>（无）</li>"}</ul>
      <div class="sh-meta">缺失证据：${(sh.missing || []).join("、") || "无"}</div>
    </div>

    <div class="sh-section">
      <h3>三、处理建议与依据（政策补偿员）</h3>
      <div>建议动作：<b>${esc(r.action || "—")}</b> ｜ 资格：${esc(r.eligibility)}</div>
      <div>理由：${esc(r.reason || "—")}</div>
      <div>预估成本：¥${r.cost ?? 0} ｜ 需主管审批：${r.approval ? "是" : "否"}</div>
      ${citedHtml}
      <div class="sh-meta">需补充凭证：${(r.requiredEvidence || []).join("、") || "无"}</div>
    </div>

    <div class="sh-section">
      <h3>四、客服回复（客服沟通员）</h3>
      <div class="sh-reply">${esc(rp.message || "（无）")}</div>
      <div class="sh-meta">阶段：${esc(rp.stage)} ｜ 请客户下一步：${esc(rp.nextAction || "—")}</div>
    </div>

    <div class="sh-section">
      <h3>五、独立风控审核（风险审核员）</h3>
      <div>结论：${esc(rv.verdict)} ｜ 评分：${rv.score ?? "?"} ${rv.mustEscalate ? "｜ 🔺 必须升级" : ""}</div>
      <ul class="sh-list">${checksHtml}</ul>
    </div>

    <div class="sh-actions">
      <button id="copyMd">复制处理单</button>
      <button id="dlMd">下载 Markdown</button>
      <button id="printSheet">打印</button>
      <button id="confirmBtn" class="confirm">模拟主管确认</button>
    </div>
    <div id="confirmNote" class="confirm-note"></div>
  `;

  $("copyMd").addEventListener("click", () => copyText(sh.markdown));
  $("dlMd").addEventListener("click", () => downloadMd(sh.markdown));
  $("printSheet").addEventListener("click", () => window.print());
  $("confirmBtn").addEventListener("click", () => {
    const note = $("confirmNote");
    note.className = "confirm-note show";
    note.textContent = sh.escalated
      ? "✅ 已记录：本单为升级件，需在抖店后台由主管人工处理，系统不自动执行任何动作。"
      : "✅ 已模拟确认。注意：本 Demo 不实际调用抖店接口——真实执行请在抖店售后后台由主管点击，系统不自动退款/补发。";
  });
}

// 把规则版本号暴露给前端（与服务端一致）

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); alert("✅ 处理单已复制到剪贴板"); }
  catch { alert("复制失败，请手动选择文本"); }
}
function downloadMd(t) {
  const blob = new Blob([t], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "代州黄酒-售后处理单.md";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 知识库标签（每个 Agent 节点展示其用到的模板） ----------
function renderKbChips() {
  if (!KB_VIEW) return;
  ["agent1", "agent2", "agent3", "agent4"].forEach((a) => {
    const ids = KB_VIEW.agentMapping[a] || [];
    const body = document.querySelector(`#node-${a} .node-body`);
    if (!body) return;
    let box = body.querySelector(".kb-chips");
    if (!box) { box = document.createElement("div"); box.className = "kb-chips"; body.appendChild(box); }
    box.innerHTML = "";
    const lab = document.createElement("span");
    lab.className = "chip-label";
    lab.textContent = "知识库：";
    box.appendChild(lab);
    KB_VIEW.templates.filter((t) => ids.includes(t.id)).forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = t.title;
      b.addEventListener("click", () => openKbModal(t.id));
      box.appendChild(b);
    });
  });
}

// ---------- 知识库弹窗：详情 + 补充 ----------
function renderKbBody(tpl) {
  try {
    if (tpl.id === "policy") {
      const rules = tpl.rules || [];
      let h = `<p class="kb-desc">${esc(tpl.desc)}</p><div class="kb-table-wrap"><table class="kb-table"><thead><tr><th>rule_id</th><th>适用</th><th>条件</th><th>动作</th><th>金额上限</th><th>所需凭证</th><th>审批</th></tr></thead><tbody>`;
      rules.forEach((r) => {
        h += `<tr><td><b>${esc(r.rule_id)}</b></td><td>${esc(r.case_type)}</td><td>${esc(r.condition)}</td><td>${esc(r.action)}</td><td>${esc(r.amount ?? "—")}</td><td>${esc((r.evidence || []).join("、") || "—")}</td><td>${r.approval ? "需审批" : "否"}</td></tr>`;
        if (r.exception) h += `<tr class="kb-sub"><td colspan="7">例外：${esc(r.exception)}</td></tr>`;
      });
      return h + "</tbody></table></div>";
    }
    if (tpl.id === "product") {
      const products = tpl.products || [];
      let h = `<p class="kb-desc">${esc(tpl.desc)}</p><div class="kb-table-wrap"><table class="kb-table"><thead><tr><th>SKU</th><th>名称</th><th>规格</th><th>包装</th><th>酒精度</th><th>易碎</th><th>参考价</th></tr></thead><tbody>`;
      products.forEach((p) => {
        h += `<tr><td>${esc(p.sku)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.spec)}</td><td>${esc(p.package)}</td><td>${esc(p.abv)}</td><td>${esc(p.fragile ? "是" + (p.fragile_level ? "·" + p.fragile_level : "") : "否")}</td><td>¥${esc(p.ref_price ?? "—")}</td></tr>`;
        if (p.carrier_restriction) h += `<tr class="kb-sub"><td colspan="7">物流限制：${esc(p.carrier_restriction)}</td></tr>`;
      });
      h += "</tbody></table></div>";
      const lg = tpl.logistics;
      if (lg) {
        h += `<div class="kb-block"><b>仓库：</b>${esc(lg.warehouse)} ｜ <b>出库：</b>${esc(lg.dispatch_sla_hours)}h（大促${esc(lg.dispatch_sla_hours_promo)}h）｜ <b>承运：</b>${esc((lg.carriers || []).join("、"))}</div>`;
        h += `<div class="kb-block"><b>分区时效(天)：</b>${Object.entries(lg.delivery_eta_days || {}).map(([k, v]) => esc(k) + " " + esc(v)).join(" ｜ ")}</div>`;
        h += `<div class="kb-block"><b>禁运：</b>${esc((lg.no_ship_regions || []).join("、"))}</div>`;
      }
      return h;
    }
    if (tpl.id === "voice") {
      const v = tpl.voice || {};
      const templates = tpl.templates || [];
      let h = `<p class="kb-desc">${esc(tpl.desc)}</p>`;
      h += `<div class="kb-block"><b>称呼：</b>${esc((v.address_forms || []).join("、"))}</div>`;
      h += `<div class="kb-block"><b>语气：</b>${esc(v.tone || "—")}</div>`;
      h += `<div class="kb-block"><b>风格：</b>${esc((v.style_rules || []).join("；"))}</div>`;
      h += `<div class="kb-block kb-forbidden"><b>禁用词：</b>${(v.forbidden_words || []).map((w) => `<span class="fw">${esc(w)}</span>`).join("")}</div>`;
      h += `<div class="kb-subtitle">回复模板</div><div class="kb-templates">`;
      templates.forEach((t) => {
        h += `<div class="kb-tpl"><div class="kb-tpl-meta">${esc(t.stage)}${t.requires_approval_first ? " · 须主管批准后使用" : ""}</div><div class="kb-tpl-text">${esc(t.text || "—")}</div></div>`;
      });
      return h + "</div>";
    }
    if (tpl.id === "cases") {
      const cases = tpl.cases || [];
      const usageRules = tpl.usageRules || [];
      let h = `<p class="kb-desc">${esc(tpl.desc)}</p><div class="kb-cases">`;
      cases.forEach((c) => {
        h += `<div class="kb-case"><div class="kb-case-head"><b>${esc(c.case_id)}</b>${c.special_approval ? ' <span class="tag-spec">曾为特批</span>' : ""}</div><div>${esc(c.summary)}</div><div class="kb-case-meta">依据：${esc((c.rules_cited || []).join("、"))} ｜ 决定：${esc(c.final_decision)} ｜ 原因：${esc(c.reason)}</div></div>`;
      });
      h += "</div>";
      h += `<div class="kb-subtitle">使用规则</div><ul class="kb-usage">${usageRules.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>`;
      return h;
    }
    return `<p class="kb-desc" style="color:var(--red)">未知模板类型：${esc(tpl.id)}</p>`;
  } catch (e) {
    return `<p class="kb-desc" style="color:var(--red)">渲染详情时出错：${esc(e.message)}<br/>模板ID：${esc(tpl?.id)}</p>`;
  }
}

function renderKbOverview() {
  if (!KB_VIEW) return "<p class=\"kb-desc\">知识库加载中…</p>";
  const templates = KB_VIEW.templates || [];
  return templates.map((t) => {
    const used = (t.usedBy || []).map((a) => AGENT_NAME[a] || a).join("、") || "—";
    let teaser = "";
    if (t.id === "policy" && t.rules) teaser = `共 ${t.rules.length} 条规则，覆盖破损、物流、口感、错发与强制升级。`;
    if (t.id === "product" && t.products) teaser = `共 ${t.products.length} 个 SKU，含包装/易碎/时效/禁运说明。`;
    if (t.id === "voice" && t.templates) teaser = `品牌语气 + ${t.templates.length} 个回复模板 + ${t.voice?.forbidden_words?.length || 0} 个禁用词。`;
    if (t.id === "cases" && t.cases) teaser = `共 ${t.cases.length} 条脱敏案例，仅作参考，不覆盖规则。`;
    return `<div class="kb-card" data-tpl="${esc(t.id)}">
      <div class="kb-card-title">📚 ${esc(t.title)}</div>
      <div class="kb-card-desc">${esc(t.desc || "")}</div>
      <div class="kb-card-meta">使用 Agent：${esc(used)}</div>
      <div class="kb-card-teaser">${esc(teaser)}</div>
    </div>`;
  }).join("");
}

function openKbModal(tplId, overview = false) {
  const modal = $("kbModal");
  // 先打开弹窗骨架，避免空窗
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  if (overview || !tplId) {
    $("kbBack").style.display = "none";
    $("kbTitle").textContent = "内置知识库总览";
    $("kbUsedBy").textContent = "四份模板 · 可点击查看详情 · 可补充内容 · 商家规则永远优先";
    $("kbBody").style.display = "none";
    $("kbBody").innerHTML = "";
    $("kbOverview").style.display = "block";
    $("kbOverview").innerHTML = renderKbOverview();
    $("kbSuppBox").style.display = "none";
    modal.dataset.tpl = "";
    return;
  }

  const tpl = KB_VIEW?.templates?.find((t) => t.id === tplId);
  if (!tpl) {
    $("kbBack").style.display = "inline-flex";
    $("kbTitle").textContent = "知识库模板";
    $("kbUsedBy").textContent = "未找到模板（" + esc(tplId) + "）";
    $("kbBody").style.display = "block";
    $("kbBody").innerHTML = `<p class="kb-desc" style="color:var(--red)">未找到该模板数据，请刷新页面重试。</p>`;
    $("kbOverview").style.display = "none";
    $("kbSuppBox").style.display = "block";
    $("kbSupp").value = "";
    modal.dataset.tpl = "";
    return;
  }

  $("kbBack").style.display = "inline-flex";
  $("kbTitle").textContent = tpl.title;
  const used = (tpl.usedBy || []).map((a) => AGENT_NAME[a] || a).join("、");
  $("kbUsedBy").textContent = "被以下 Agent 使用：" + (used || "—") + " · 点击标题旁 ✕ 关闭";
  $("kbBody").style.display = "block";
  $("kbBody").innerHTML = renderKbBody(tpl);
  $("kbOverview").style.display = "none";
  $("kbSuppBox").style.display = "block";
  $("kbSupp").value = supplements[tpl.id] || "";
  $("kbSaved").textContent = "";
  modal.dataset.tpl = tpl.id;
}

function closeKbModal() {
  const modal = $("kbModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

$("kbOverviewBtn").addEventListener("click", () => openKbModal(null, true));
$("kbBack").addEventListener("click", () => openKbModal(null, true));
$("kbClose").addEventListener("click", closeKbModal);
$("kbModal").addEventListener("click", (e) => {
  if (e.target.id === "kbModal") closeKbModal();
  // 总览卡片点击 -> 打开详情
  const card = e.target.closest(".kb-card");
  if (card) {
    const id = card.dataset.tpl;
    if (id) openKbModal(id);
  }
});
$("kbSave").addEventListener("click", () => {
  const id = $("kbModal").dataset.tpl;
  if (!id) return;
  supplements[id] = $("kbSupp").value.trim();
  $("kbSaved").textContent = "✅ 已保存，将在下次试跑时随该模板发给对应 Agent";
});

runBtn.addEventListener("click", run);
