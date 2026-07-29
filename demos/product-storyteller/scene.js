/* 产品会说话 — D3 长卷场景渲染器（预览与下载 HTML 共用）
 * 全局暴露 PSScene.render(rootEl, data, theme)
 * theme: gufa(古法卷轴) | blueprint(建筑蓝图) | flow(现代数据流)
 * 依赖 window.d3 (v7)；若 d3 未加载，自动降级为静态时间线。
 */
(function () {
  "use strict";

  const THEMES = {
    gufa: {
      label: "古法卷轴",
      river: "#4a3c2f", riverSoft: "rgba(74,60,47,.18)",
      node: "#a04226", nodeText: "#fff",
      label_: "#3d3835", note: "#8a7f76",
      particleFrom: "#d9b36a", particleTo: "#a04226",
      particleN: 16,
    },
    blueprint: {
      label: "建筑蓝图",
      river: "#bcd9ff", riverSoft: "rgba(188,217,255,.16)",
      node: "#0f3560", nodeText: "#cfe6ff",
      label_: "#dcecff", note: "#7fa8d4",
      particleFrom: "#9fd0ff", particleTo: "#ffffff",
      particleN: 12,
    },
    flow: {
      label: "现代数据流",
      river: "url(#ps-flow-grad)", riverSoft: "rgba(94,234,212,.10)",
      node: "#101826", nodeText: "#5eead4",
      label_: "#e2e8f0", note: "#64748b",
      particleFrom: "#5eead4", particleTo: "#a78bfa",
      particleN: 20,
    },
  };

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* 步骤裁剪：3–10 步，超出把多余的并入最后一步 */
  function clampSteps(steps) {
    const arr = (steps || []).filter((s) => s && s.name);
    if (arr.length <= 10) return arr;
    const head = arr.slice(0, 9);
    const rest = arr.slice(9);
    head.push({
      name: rest.map((s) => s.name).join("·").slice(0, 12),
      story: rest.map((s) => s.story || "").join(" "),
      secret: rest.find((s) => s.secret)?.secret || "",
      note: rest[rest.length - 1].note || "",
    });
    return head;
  }

  /* ---------- 卖点卡片 + 页面骨架 ---------- */
  function storySkeleton(d, theme, standalone) {
    const sp = (d.sellingPoints || [])
      .map(
        (s, i) => `<div class="sp-card" style="--d:${i * 90}ms" onclick="this.classList.toggle('open')">
  <div class="sp-icon">${esc(s.icon || "✨")}</div>
  <div class="sp-title">${esc(s.title)}</div>
  <div class="sp-detail">${esc(s.detail)}</div>
  <div class="sp-more">点击查看细节 ▾</div>
</div>`
      )
      .join("");
    return `<div class="story" data-theme="${theme}">
  <div class="story-hero"><h1>${esc(d.name)}</h1><p class="tagline">${esc(d.tagline || "")}</p></div>
  <div class="story-section"><h2>为什么值得选</h2><div class="sp-grid">${sp}</div></div>
  <div class="story-section scroll-section">
    <h2>它是怎么做出来的</h2>
    <p class="scroll-hint">← 左右滑动长卷 · 点节点看门道 →</p>
    <div class="scrollwrap"></div>
    <div class="step-detail"></div>
  </div>
  <div class="story-footer">本页由「产品会说话」生成 · 点击卡片与节点可互动${standalone ? "" : "（预览）"}</div>
</div>`;
  }

  /* ---------- D3 长卷场景 ---------- */
  function renderScroll(wrap, detailEl, steps, theme, tconf) {
    const d3 = window.d3;
    const n = steps.length;
    const segW = 220, margin = 100, H = 340, riverY = 175, wave = 44;
    const W = margin * 2 + Math.max(1, n - 1) * segW;

    const pts = steps.map((s, i) => ({
      x: margin + i * segW,
      y: riverY + (i % 2 === 0 ? -wave : wave) * (n === 1 ? 0 : 1),
      step: s, i,
    }));

    const svg = d3
      .select(wrap)
      .append("svg")
      .attr("class", "ps-svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("width", W)
      .attr("height", H);

    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id", "ps-flow-grad").attr("x1", "0").attr("x2", "1");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#22d3ee");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#a78bfa");
    const glow = defs.append("filter").attr("id", "ps-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
    glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
    const m = glow.append("feMerge");
    m.append("feMergeNode").attr("in", "b");
    m.append("feMergeNode").attr("in", "SourceGraphic");

    /* 蓝图主题：网格背景 */
    if (theme === "blueprint") {
      const pat = defs.append("pattern").attr("id", "ps-grid").attr("width", 28).attr("height", 28).attr("patternUnits", "userSpaceOnUse");
      pat.append("path").attr("d", "M28 0H0V28").attr("fill", "none").attr("stroke", "rgba(188,217,255,.10)").attr("stroke-width", 1);
      svg.append("rect").attr("width", W).attr("height", H).attr("fill", "url(#ps-grid)");
    }

    const line = d3.line().x((p) => p.x).y((p) => p.y).curve(d3.curveCatmullRom.alpha(0.7));
    const dPath = line(pts);

    /* 河床（宽软底） */
    svg.append("path").attr("d", dPath).attr("fill", "none")
      .attr("stroke", tconf.riverSoft).attr("stroke-width", 26).attr("stroke-linecap", "round");
    /* 蓝图：虚线导引层 */
    if (theme === "blueprint")
      svg.append("path").attr("d", dPath).attr("fill", "none")
        .attr("stroke", "rgba(188,217,255,.35)").attr("stroke-width", 1).attr("stroke-dasharray", "6 6");

    /* 主河道：描边生长动画 */
    const river = svg.append("path").attr("d", dPath).attr("fill", "none")
      .attr("stroke", theme === "flow" ? "url(#ps-flow-grad)" : tconf.river)
      .attr("stroke-width", theme === "gufa" ? 5 : 3)
      .attr("stroke-linecap", "round");
    if (theme === "flow") river.attr("filter", "url(#ps-glow)");
    const totalLen = river.node().getTotalLength();
    river
      .attr("stroke-dasharray", `${totalLen} ${totalLen}`)
      .attr("stroke-dashoffset", totalLen)
      .transition().duration(1800).ease(d3.easeCubicInOut)
      .attr("stroke-dashoffset", 0)
      .on("end", () => river.attr("stroke-dasharray", null));

    /* 节点 */
    const nodeG = svg.selectAll(".ps-node").data(pts).enter()
      .append("g").attr("class", "ps-node")
      .attr("transform", (p) => `translate(${p.x},${p.y})`)
      .style("cursor", "pointer").style("opacity", 0);

    if (theme === "gufa") {
      /* 印章：红底圆角方块 */
      nodeG.append("rect").attr("x", -17).attr("y", -17).attr("width", 34).attr("height", 34)
        .attr("rx", 6).attr("fill", tconf.node).attr("stroke", "#7a2f18").attr("stroke-width", 2);
      nodeG.append("text").attr("class", "ps-node-num").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", tconf.nodeText).attr("font-size", 15).attr("font-weight", 700).text((p) => p.i + 1);
    } else if (theme === "blueprint") {
      nodeG.append("circle").attr("r", 22).attr("fill", "none")
        .attr("stroke", "rgba(188,217,255,.4)").attr("stroke-width", 1).attr("stroke-dasharray", "3 4");
      nodeG.append("circle").attr("r", 15).attr("fill", tconf.node).attr("stroke", tconf.river).attr("stroke-width", 1.5);
      nodeG.append("text").attr("class", "ps-node-num").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", tconf.nodeText).attr("font-size", 12).attr("font-family", "ui-monospace,Menlo,monospace").text((p) => p.i + 1);
    } else {
      /* 六边形 */
      const hex = (r) => d3.range(6).map((k) => {
        const a = (Math.PI / 3) * k - Math.PI / 2;
        return [r * Math.cos(a), r * Math.sin(a)];
      }).map((q, k) => (k ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join("") + "Z";
      nodeG.append("path").attr("d", hex(18)).attr("fill", tconf.node)
        .attr("stroke", "url(#ps-flow-grad)").attr("stroke-width", 2).attr("filter", "url(#ps-glow)");
      nodeG.append("text").attr("class", "ps-node-num").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", tconf.nodeText).attr("font-size", 13).attr("font-weight", 700).text((p) => p.i + 1);
    }

    /* 步骤名 + 年份/时长标注（与节点错开在另一侧） */
    nodeG.append("text").attr("class", "ps-node-name").attr("text-anchor", "middle")
      .attr("y", (p) => (p.i % 2 === 0 ? -34 : 46))
      .attr("fill", tconf.label_).attr("font-size", 14).attr("font-weight", 600)
      .text((p) => String(p.step.name || "").slice(0, 8));
    nodeG.append("text").attr("class", "ps-node-note").attr("text-anchor", "middle")
      .attr("y", (p) => (p.i % 2 === 0 ? -54 : 66))
      .attr("fill", tconf.note).attr("font-size", 11.5)
      .text((p) => String(p.step.note || "").slice(0, 12));

    nodeG.transition().delay((p) => 700 + p.i * 240).duration(450)
      .style("opacity", 1)
      .attrTween("transform", function (p) {
        return (t) => `translate(${p.x},${p.y - 14 * (1 - t)})`;
      });

    /* 粒子：沿河流动，颜色随行程渐变（米粒 → 酒滴） */
    const pathNode = river.node();
    const colorScale = d3.interpolateRgb(tconf.particleFrom, tconf.particleTo);
    const parts = d3.range(tconf.particleN).map((i) => ({
      phase: i / tconf.particleN + Math.random() * 0.04,
      speed: 14000 + Math.random() * 9000,
      r: theme === "flow" ? 2 + Math.random() * 2.2 : 2.4 + Math.random() * 2,
    }));
    const pSel = svg.selectAll(".ps-part").data(parts).enter()
      .append("circle").attr("class", "ps-part")
      .attr("r", (p) => p.r).style("opacity", 0);
    if (theme === "flow") pSel.attr("filter", "url(#ps-glow)");

    const timer = d3.timer((t) => {
      if (!pathNode.isConnected) { timer.stop(); return; }
      pSel.each(function (p) {
        const prog = (t / p.speed + p.phase) % 1;
        const pt = pathNode.getPointAtLength(prog * totalLen);
        d3.select(this)
          .attr("cx", pt.x).attr("cy", pt.y + Math.sin(t / 400 + p.phase * 20) * 3)
          .attr("fill", colorScale(prog))
          .style("opacity", t > 1600 ? 0.45 + 0.5 * Math.sin(prog * Math.PI) : 0);
      });
    });

    /* 节点点击 → 详情面板 */
    let autoTimer = null;
    function select(i, byUser) {
      if (byUser === true && autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      nodeG.classed("active", (p) => p.i === i);
      nodeG.select("rect,circle:not([stroke-dasharray]),path").transition().duration(300)
        .attr("transform", (p) => (p.i === i ? "scale(1.25)" : "scale(1)"));
      const s = steps[i];
      detailEl.classList.remove("show");
      void detailEl.offsetWidth; /* 重启动画 */
      detailEl.innerHTML = `<div class="sd-head">第 ${i + 1} 步 · ${esc(s.name)}${s.note ? `<span class="sd-note">${esc(s.note)}</span>` : ""}</div>
<div class="sd-story">${esc(s.story || "")}</div>
${s.secret ? `<div class="sd-secret">🔑 行家门道：${esc(s.secret)}</div>` : ""}`;
      detailEl.classList.add("show");
      /* 让当前节点滚到可视区中间 */
      if (byUser === "auto") {
        const nodeX = pts[i].x * (wrap.querySelector("svg").clientWidth / W);
        wrap.scrollTo({ left: nodeX - wrap.clientWidth / 2, behavior: "smooth" });
      }
    }
    nodeG.on("click", (_, p) => select(p.i, true));

    /* 自动巡演：河道画完后从第 1 步开始轮播，用户一点击就停 */
    setTimeout(() => {
      let cur = 0;
      select(0, "auto");
      autoTimer = setInterval(() => {
        cur = (cur + 1) % n;
        if (!wrap.isConnected) { clearInterval(autoTimer); return; }
        select(cur, "auto");
      }, 3000);
    }, 2000);
  }

  /* ---------- 无 d3 时的降级：静态竖向时间线 ---------- */
  function renderFallback(wrap, detailEl, steps) {
    wrap.innerHTML = `<div class="timeline">${steps
      .map(
        (s, i) => `<div class="tl-step" onclick="this.classList.toggle('open')">
  <div class="tl-name">第 ${i + 1} 步 · ${esc(s.name)}${s.note ? ` <span class="sd-note">${esc(s.note)}</span>` : ""} <span class="tl-more">▾</span></div>
  <div class="tl-body"><div class="tl-story">${esc(s.story || "")}</div>
  ${s.secret ? `<div class="tl-secret">🔑 行家门道：${esc(s.secret)}</div>` : ""}</div>
</div>`
      )
      .join("")}</div>`;
    detailEl.style.display = "none";
  }

  function render(rootEl, data, theme, standalone) {
    theme = THEMES[theme] ? theme : "gufa";
    const tconf = THEMES[theme];
    rootEl.innerHTML = storySkeleton(data, theme, standalone);
    const wrap = rootEl.querySelector(".scrollwrap");
    const detailEl = rootEl.querySelector(".step-detail");
    const steps = clampSteps(data.steps);

    if (window.d3 && steps.length >= 1) renderScroll(wrap, detailEl, steps, theme, tconf);
    else renderFallback(wrap, detailEl, steps);

    /* 卖点卡片入场动画 */
    const cards = rootEl.querySelectorAll(".sp-card");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }), { threshold: 0.15 });
      cards.forEach((c) => io.observe(c));
    } else cards.forEach((c) => c.classList.add("in"));
  }

  window.PSScene = { render, THEMES };
})();
