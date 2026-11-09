/**
 * globe.js — Satellite globe for the Intel Portal landing view.
 * The sphere is a Blue Marble image. Red points come from report locations.
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
    SIZE = Math.floor(Math.max(200, Math.min(500, parentWidth - 8, byHeight)));
    canvas.style.width = SIZE + "px";
    canvas.style.height = SIZE + "px";
    canvas.width = Math.round(SIZE * DPR);
    canvas.height = Math.round(SIZE * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = SIZE / 2;
    CY = SIZE / 2;
    R = SIZE * 0.42;
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

  function drawMarkers(time) {
    for (var hi = 0; hi < markers.length; hi++) {
      var hp = project(markers[hi].lat, markers[hi].lng);
      if (!hp.visible) continue;
      var blinkOn = Math.sin(time * 0.008 + hi * 1.2) > 0.2;
      var pingPhase = (time * 0.0012 + hi * 0.55) % 1.6;
      if (pingPhase < 1) {
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 3 + pingPhase * 14, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(248, 113, 113, " + (0.7 * (1 - pingPhase)).toFixed(2) + ")";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, blinkOn ? 3.6 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = blinkOn ? "rgba(239, 68, 68, 1)" : "rgba(239, 68, 68, 0.4)";
      ctx.fill();
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
    rotation += 0.0015;
    drawGlobe(time);
    requestAnimationFrame(animate);
  }

  window.GoatGlobe = {
    setMarkers: function (list) {
      var next = [];
      if (list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].lat == null || list[i].lng == null || list[i].lat === "" || list[i].lng === "") continue;
          var lat = Number(list[i].lat);
          var lng = Number(list[i].lng);
          if (!isFinite(lat) || !isFinite(lng)) continue;
          if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
          next.push({ lat: lat, lng: lng });
        }
      }
      markers = next;
    }
  };

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(function () {
    resize();
    animate(performance.now());
  });
})();
