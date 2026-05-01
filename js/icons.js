function createPlaneIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.translate(24, 24);
    ctx.fillStyle = '#f6c400';
    ctx.strokeStyle = '#6d5700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(5, -4);
    ctx.lineTo(20, 3);
    ctx.lineTo(20, 8);
    ctx.lineTo(4, 5);
    ctx.lineTo(4, 16);
    ctx.lineTo(10, 20);
    ctx.lineTo(10, 23);
    ctx.lineTo(0, 18);
    ctx.lineTo(-10, 23);
    ctx.lineTo(-10, 20);
    ctx.lineTo(-4, 16);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-20, 8);
    ctx.lineTo(-20, 3);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return canvas.toDataURL();
}

window.PLANE_ICON = createPlaneIcon();

function createShipIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.translate(36, 36);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#d8f5ff';
    ctx.strokeStyle = '#5f3718';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -25);
    ctx.lineTo(0, 10);
    ctx.stroke();

    ctx.fillStyle = '#f7efe0';
    ctx.beginPath();
    ctx.moveTo(2, -22);
    ctx.lineTo(20, 1);
    ctx.lineTo(2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.moveTo(-2, -18);
    ctx.lineTo(-18, 4);
    ctx.lineTo(-2, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8b4f24';
    ctx.strokeStyle = '#4b2a13';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-25, 10);
    ctx.quadraticCurveTo(0, 25, 25, 10);
    ctx.lineTo(16, 20);
    ctx.quadraticCurveTo(0, 29, -16, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#f3d6a0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 17);
    ctx.lineTo(14, 17);
    ctx.stroke();

    return canvas.toDataURL();
}

window.SHIP_ICON = createShipIcon();

