/**
 * globe.js — Satellite globe for the Intel Portal landing view.
 * The sphere is a Blue Marble image. Red points are supplied by the dashboard.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("globe-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var SIZE = 380, CX = 190, CY = 190, R = 160;
  var rotation = 0;
  var tilt = 0.35;
  var DPR = window.devicePixelRatio || 1;
  var markers = [];
  var onSelect = null;
  var HIT_RADIUS = 16;
  var dragging = false;
  var dragMoved = false;
  var dragX = 0;
  var dragY = 0;
  var activePointer = null;
  var TILT_LIMIT = 1.15;

  var earthImg = new Image();
  var earthPixels = null;
  var earthW = 0;
  var earthH = 0;
  var off = document.createElement("canvas");
  var octx = off.getContext("2d", { willReadFrequently: true });
  var frame = null;
  var frameSize = 0;

  earthImg.onload = function () {
    var scratch = document.createElement("canvas");
    earthW = earthImg.naturalWidth;
    earthH = earthImg.naturalHeight;
    scratch.width = earthW;
    scratch.height = earthH;
    var sctx = scratch.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(earthImg, 0, 0);
    earthPixels = sctx.getImageData(0, 0, earthW, earthH).data;
  };
  earthImg.src = "img/earth.jpg";

  function resize() {
    var wrapper = canvas.parentElement;
    var viewer = canvas.closest(".report-viewer");
    var available = viewer ? viewer.clientHeight : window.innerHeight - 70;
    var note = document.querySelector(".report-placeholder .source-note");
    var placeholder = document.querySelector(".report-placeholder");
    var used = 0;
    if (note) used += note.offsetHeight;
    var caption = wrapper.querySelector(".globe-caption");
    var hudTop = wrapper.querySelector(".globe-hud-top");
    var hudBottom = wrapper.querySelector(".globe-hud-bottom");
    if (caption) used += caption.offsetHeight;
    if (hudTop) used += hudTop.offsetHeight;
    if (hudBottom) used += hudBottom.offsetHeight;
    if (placeholder) {
      var pad = getComputedStyle(placeholder);
      used += (parseFloat(pad.paddingTop) || 0) + (parseFloat(pad.paddingBottom) || 0);
    }
    var wrap = getComputedStyle(wrapper);
    used += (parseFloat(wrap.marginTop) || 0) + (parseFloat(wrap.marginBottom) || 0);
    var parentWidth = wrapper.getBoundingClientRect().width || 500;
    var byHeight = available - used - 6;
    SIZE = Math.floor(Math.max(220, Math.min(560, parentWidth - 8, byHeight)));
    canvas.style.width = SIZE + "px";
    canvas.style.height = SIZE + "px";
    canvas.width = Math.round(SIZE * DPR);
    canvas.height = Math.round(SIZE * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = SIZE / 2;
    CY = SIZE / 2;
    R = Math.min(SIZE * 0.46, SIZE / 2 - 16);
    frame = null;
    frameSize = 0;
  }

  function project(lat, lng) {
    var phi = lat * Math.PI / 180;
    var theta = lng * Math.PI / 180 + rotation;
    var x = Math.cos(phi) * Math.sin(theta);
    var y = Math.sin(phi);
    var z = Math.cos(phi) * Math.cos(theta);
    var y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    var z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return {
      x: CX + x * R,
      y: CY - y2 * R,
      z: z2,
      visible: z2 > 0.02
    };
  }

  function paintEarth() {
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    if (!earthPixels) {
      ctx.fillStyle = "#12304a";
      ctx.fill();
      return;
    }
    if (frameSize !== SIZE) {
      off.width = SIZE;
      off.height = SIZE;
      frame = octx.createImageData(SIZE, SIZE);
      frameSize = SIZE;
    }
    var data = frame.data;
    var cosT = Math.cos(tilt);
    var sinT = Math.sin(tilt);
    var maxX = earthW - 1;
    var maxY = earthH - 1;
    for (var sy = 0; sy < SIZE; sy++) {
      var y2 = (CY - sy) / R;
      var row = sy * SIZE;
      for (var sx = 0; sx < SIZE; sx++) {
        var di = (row + sx) * 4;
        var x = (sx - CX) / R;
        var rr = x * x + y2 * y2;
        if (rr > 1) {
          data[di + 3] = 0;
          continue;
        }
        var z2 = Math.sqrt(1 - rr);
        var y = y2 * cosT + z2 * sinT;
        var z = -y2 * sinT + z2 * cosT;
        if (y > 1) y = 1;
        if (y < -1) y = -1;
        var lat = Math.asin(y);
        var theta = Math.atan2(x, z);
        var lng = theta - rotation;
        var u = (lng / (Math.PI * 2)) + 0.5;
        u = u - Math.floor(u);
        var v = (Math.PI / 2 - lat) / Math.PI;
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        var tx = (u * maxX) | 0;
        var ty = (v * maxY) | 0;
        var ti = (ty * earthW + tx) * 4;
        var shade = 0.42 + 0.58 * z2;
        data[di] = earthPixels[ti] * shade;
        data[di + 1] = earthPixels[ti + 1] * shade;
        data[di + 2] = earthPixels[ti + 2] * shade;
        data[di + 3] = 255;
      }
    }
    octx.putImageData(frame, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  // One dot per country. Every report from that country stays on the dot.
  function visualPoints() {
    var groups = {};
    var order = [];
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      var key = m.lat.toFixed(3) + "," + m.lng.toFixed(3);
      if (!groups[key]) {
        groups[key] = { lat: m.lat, lng: m.lng, ids: [] };
        order.push(key);
      }
      if (groups[key].ids.indexOf(m.id) === -1) groups[key].ids.push(m.id);
    }
    var out = [];
    for (var g = 0; g < order.length; g++) {
      var group = groups[order[g]];
      group.ids.sort();
      var p = project(group.lat, group.lng);
      out.push({ x: p.x, y: p.y, visible: p.visible, ids: group.ids });
    }
    return out;
  }

  function hitMarkers(x, y) {
    var pts = visualPoints();
    var nearest = null;
    var nearestD = HIT_RADIUS;
    for (var i = 0; i < pts.length; i++) {
      if (!pts[i].visible || !pts[i].ids.length) continue;
      var dx = pts[i].x - x;
      var dy = pts[i].y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= nearestD) {
        nearestD = d;
        nearest = pts[i];
      }
    }
    if (!nearest) return [];
    var ids = nearest.ids.slice();
    for (var j = 0; j < pts.length; j++) {
      if (pts[j] === nearest || !pts[j].visible) continue;
      var ox = pts[j].x - nearest.x;
      var oy = pts[j].y - nearest.y;
      // Countries that draw on top of each other open together.
      if (Math.sqrt(ox * ox + oy * oy) > 18) continue;
      for (var k = 0; k < pts[j].ids.length; k++) {
        if (ids.indexOf(pts[j].ids[k]) === -1) ids.push(pts[j].ids[k]);
      }
    }
    return ids;
  }

  function drawMarkers(time) {
    var pts = visualPoints();
    for (var hi = 0; hi < pts.length; hi++) {
      if (!pts[hi].visible) continue;
      var blinkOn = Math.sin(time * 0.008 + hi * 1.2) > 0.2;
      var pingPhase = (time * 0.0012 + hi * 0.55) % 1.6;
      if (pingPhase < 1) {
        ctx.beginPath();
        ctx.arc(pts[hi].x, pts[hi].y, 3 + pingPhase * 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(248, 113, 113, " + (0.7 * (1 - pingPhase)).toFixed(2) + ")";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(pts[hi].x, pts[hi].y, blinkOn ? 4.2 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = blinkOn ? "rgba(239, 68, 68, 1)" : "rgba(239, 68, 68, 0.55)";
      ctx.fill();
      if (pts[hi].ids.length > 1) {
        ctx.font = "600 11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(254, 226, 226, 0.95)";
        ctx.fillText(String(pts[hi].ids.length), pts[hi].x + 8, pts[hi].y);
      }
    }
  }

  function drawGlobe(time) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    paintEarth();
    ctx.beginPath();
    ctx.arc(CX, CY, R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(186, 214, 232, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    drawMarkers(time);
  }

  function animate(time) {
    if (!dragging) rotation += 0.0015;
    drawGlobe(time);
    requestAnimationFrame(animate);
  }

  function onDisc(pt) {
    var x = (pt.x - CX) / R;
    var y = (CY - pt.y) / R;
    return x * x + y * y <= 1;
  }

  function endDrag(ev) {
    if (!dragging || ev.pointerId !== activePointer) return;
    dragging = false;
    activePointer = null;
    if (canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ }
    }
  }

  function eventPoint(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (SIZE / rect.width),
      y: (ev.clientY - rect.top) * (SIZE / rect.height)
    };
  }

  canvas.style.touchAction = "none";

  canvas.addEventListener("pointerdown", function (ev) {
    if (ev.button != null && ev.button !== 0) return;
    var pt = eventPoint(ev);
    if (!onDisc(pt)) return;
    dragging = true;
    dragMoved = false;
    dragX = ev.clientX;
    dragY = ev.clientY;
    activePointer = ev.pointerId;
    if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (dragging && ev.pointerId === activePointer) {
      var dx = ev.clientX - dragX;
      var dy = ev.clientY - dragY;
      if (!dragMoved && dx * dx + dy * dy < 25) return;
      dragMoved = true;
      var rect = canvas.getBoundingClientRect();
      var scaleX = SIZE / (rect.width || SIZE);
      var scaleY = SIZE / (rect.height || SIZE);
      rotation += dx * scaleX / R;
      tilt += dy * scaleY / R;
      if (tilt > TILT_LIMIT) tilt = TILT_LIMIT;
      if (tilt < -TILT_LIMIT) tilt = -TILT_LIMIT;
      dragX = ev.clientX;
      dragY = ev.clientY;
      canvas.style.cursor = "grabbing";
      return;
    }
    var pt = eventPoint(ev);
    if (hitMarkers(pt.x, pt.y).length) canvas.style.cursor = "pointer";
    else if (onDisc(pt)) canvas.style.cursor = "grab";
    else canvas.style.cursor = "default";
  });

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", function (ev) {
    endDrag(ev);
    dragMoved = false;
  });

  canvas.addEventListener("click", function (ev) {
    if (dragMoved) {
      dragMoved = false;
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    var pt = eventPoint(ev);
    var ids = hitMarkers(pt.x, pt.y);
    if (!onSelect) return;
    if (ids.length) ev.stopPropagation();
    onSelect(ids, ev.clientX, ev.clientY);
  });

  window.GoatGlobe = {
    setMarkers: function (list) {
      var next = [];
      if (list) {
        for (var i = 0; i < list.length; i++) {
          if (!list[i] || list[i].id == null || list[i].id === "") continue;
          if (list[i].lat == null || list[i].lng == null || list[i].lat === "" || list[i].lng === "") continue;
          var lat = Number(list[i].lat);
          var lng = Number(list[i].lng);
          if (!isFinite(lat) || !isFinite(lng)) continue;
          if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
          next.push({ id: String(list[i].id), lat: lat, lng: lng });
        }
      }
      markers = next;
    },
    onSelect: function (fn) {
      onSelect = typeof fn === "function" ? fn : null;
    }
  };

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(function () {
    resize();
    animate(performance.now());
  });
})();
