// ===== 代州黄酒 · 售后分流台 Demo 前端 =====
// 后端持有 Key，前端以 SSE 流式接收四 Agent 结果，点亮流水线并渲染处理单。

// 与 server.js / kb-default.json 保持一致
const POLICY_VERSION = "huangjiu-default-v1.0";

const $ = (id) => document.getElementById(id);
const runBtn = $("runBtn");
const statusEl = $("status");

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
    $("logistics").value = ex.logistics;
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

// ---------- 主流程 ----------
async function run() {
  const payload = {
    product: $("product").value,
    order_status: $("order_status").value,
    case_type_hint: $("case_type_hint").value,
    complaint: $("complaint").value.trim(),
    logistics: $("logistics").value.trim(),
    history: $("history").value.trim(),
    custom_rules: $("custom_rules").value.trim(),
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

runBtn.addEventListener("click", run);
