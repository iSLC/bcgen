const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const barcoder = require('barcoder');
const bardcode = require("bardcode");
const bodyParser = require('body-parser');
const PDFMerger = require('pdf-merger-js');
const findRemoveSync = require('find-remove');
const {createCanvas, registerFont, loadImage} = require('canvas');
// --------------------------------------------------------------------------------------------------------------------
registerFont('font/unispace.rg.ttf', {family: 'Unispace'});
// --------------------------------------------------------------------------------------------------------------------
const port = 8080;
const app = express();
// --------------------------------------------------------------------------------------------------------------------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
// --------------------------------------------------------------------------------------------------------------------
app.use('/out', express.static(path.join(__dirname, 'out')));
// --------------------------------------------------------------------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});
// --------------------------------------------------------------------------------------------------------------------
const PAGE_W = 2480;
const PAGE_H = 3508;
const CODE_W = Math.round(PAGE_W / 4);
const CODE_H = Math.round(PAGE_H / 10);
// --------------------------------------------------------------------------------------------------------------------
function GenerateBarcode(ctx, t, l, b, r, type, id, color, code, num1, num2) {
    // Paing outer frame
    ctx.beginPath();
    ctx.moveTo(l + 64, t + 32);
    ctx.lineTo(r - 64, t + 32);
    ctx.lineTo(r - 64, b - 32);
    ctx.lineTo(l + 64, b - 32);
    ctx.lineTo(l + 64, t + 32);
    ctx.closePath();
    ctx.stroke();
    // Paint inner box
    ctx.beginPath();
    ctx.moveTo(r - 128, t + 36);
    ctx.lineTo(r - 128, b - 36);
    ctx.lineTo(l + 224, b - 36);
    ctx.lineTo(l + 224, t + 36);
    ctx.lineTo(r - 128, t + 36);
    ctx.closePath();
    ctx.stroke();
    // Paint top innner separator
    ctx.beginPath();
    ctx.moveTo(r - 192, t + 36);
    ctx.lineTo(r - 192, b - 36);
    ctx.closePath();
    ctx.stroke();
    // Paint bottom innner separator
    ctx.beginPath();
    ctx.moveTo(l + 288, t + 36);
    ctx.lineTo(l + 288, b - 36);
    ctx.closePath();
    ctx.stroke();
    // Paint middle separator
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(l + 288, t + (b - t) / 2);
    ctx.lineTo(r - 192, t + (b - t) / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // Paint Type
    ctx.save();
    ctx.font = '40px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 96, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${type}`, 0, 20);
    ctx.restore();
    // Paint ID
    ctx.save();
    ctx.font = '26px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 160, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${id}`, 0, 14);
    ctx.restore();
    // Paint #1 Label
    ctx.save();
    ctx.font = '24px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 216, t + 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('Text', 0, 12);
    ctx.restore();
    // Paint #1 Label
    ctx.save();
    ctx.font = '24px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 216, b - 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('Text', 0, 12);
    ctx.restore();
    // Paint #1
    ctx.save();
    ctx.font = '72px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 344, t + 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${num1}`, 0, 36);
    ctx.restore();
    // Paint #2
    ctx.save();
    ctx.font = '72px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 344, b - 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${num2}`, 0, 36);
    ctx.restore();
    // Paint Color
    ctx.save();
    ctx.font = '28px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 256, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${color}`, 0, 14);
    ctx.restore();
    // Draw bar-code
    bardcode.drawBarcode(ctx, `${code}`, {
        type: 'EAN-13',
        x: l + 160,
        y: t + (b - t) / 2,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        angle: 90,
        width: (b - t) - 32
    });
    // Paint bar-code text
    ctx.save();
    ctx.font = '22px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 86, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${code}`, 0, 8);
    ctx.restore();
}
// --------------------------------------------------------------------------------------------------------------------
function RandomName(ext) { return `bc.${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`; }
// --------------------------------------------------------------------------------------------------------------------
app.post('/pdf', (req, res) => {
    // Check for empty request
    if (typeof req.body !== 'object' || req.body === null) {
        res.send('@Invalid request body');
        return;
    }
    // File name
    var name = RandomName('pdf');
    // File path
    var fp = path.join('out/', name);
    // File name list
    var file_list = [fp];
    // Create canvas
    var canvas = createCanvas(PAGE_W, PAGE_H, 'pdf');
    var ctx = canvas.getContext('2d');
    // Bar-code count, row/column and failure state
    var count = 0, row = 0, col = 0, failed = null;
    // Top/Left/Bottom/Right points
    var top = 0, left = 0, bottom = 0, right = 0;
    // Iterate over requested bar-code entries
    req.body.every(function(e, idx) {
        // Amount of bar-codes to create
        var amount = parseInt(e.amount);
        // Break if amount is not valid
        if (!e.amount || amount < 1 || amount > 1000) return !(failed = `@Invalid amount ${amount}`);
        // Fetch article information
        var type = e.type, id = e.id, color = e.color, code = e.code, num1 = parseInt(e.num1), num2 = parseInt(e.num2);
        // Break if information is not valid
        if (!code || code.length != 12 || barcoder.validate(`${code}`)) return !(failed = `@Invalid ean code ${code}`);
        if (!type || type.length < 1 || type.length > 12) return !(failed = `@Invalid type ${type}`);
        if (!id || id.length < 1 || id.length > 16) return !(failed = `@Invalid id ${id}`);
        if (!color || color.length < 1 || color.length > 16) return !(failed = `@Invalid color ${color}`);
        if (!e.num1 || num1 < 0 || num1 > 99) return !(failed = `@Invalid number ${num1}`);
        if (!e.num2 || num2 < 0 || num2 > 99) return !(failed = `@Invalid number ${num2}`);
        // Generate article bar-codes
        for (var i = 0; i < amount; ++i) {
            // Limit bar-code count
            if (count >= 2000) {
                 return !(failed = `@Article limit reached ${count}`);
            }
            // Advance page, if necessary
            if (row == 9 && col == 4) {
                // Write current file
                fs.writeFileSync(fp, canvas.toBuffer());
                // File name
                name = RandomName('pdf');
                // File path
                fp = path.join('out/', name);
                // Append to name list
                file_list.push(fp);
                // Create new canvas
                canvas = createCanvas(PAGE_W, PAGE_H, 'pdf');
                ctx = canvas.getContext('2d');
                // Reset row and column
                row = 0, col = 0;
            }
            // Advance row
            if (col == 4) {
                ++row;
                col=0;
            }
            // Compute bar-code frame
            top = CODE_H * row;
            left = CODE_W * col;
            bottom = top + CODE_H;
            right = left + CODE_W;
            // Next column
            ++col;
            // Next bar-code
            ++count;
            // Paint content
            GenerateBarcode(ctx, top, left, bottom, right, type, id, color, code, num1, num2);
        }
        // Process next one
        return true;
    });
    // Write generated file
    if (!failed && count) {
        fs.writeFileSync(fp, canvas.toBuffer());
    // Should we remove leftover files?
    } else if (failed && file_list.length > 1) {
        // Erase temporary files
        file_list.every(function(p, idx) {
            fs.unlink((p), err => {
                if (err) console.log(err);
            });
            // Next path
            return true;
        });
    }
    // Return response
    if (failed) {
        // Log event
        if (count) console.log(`PDF generation failed: ${failed}`);
        // Return reason
        res.send(failed);
        // Stop here
        return;
    // Do we have multiple documents?
    } else if (file_list.length > 1) {
        var merger = new PDFMerger();
        // Add documents to be merged
        file_list.every(function(p, idx) {
            merger.add(p);
            // Next path
            return true;
        });
        // File name
        name = RandomName('pdf');
        // File path
        fp = path.join('out/', name);
        // Save combined file
        merger.save(fp);
        // Erase temporary files
        file_list.every(function(p, idx) {
            fs.unlink((p), err => {
                if (err) console.log(err);
            });
            // Next path
            return true;
        });
    }
    // Return file name
    res.send(name);
});
// --------------------------------------------------------------------------------------------------------------------
app.listen(port, () => {
    console.log(`Application accessible on port ${port}`);
});
// --------------------------------------------------------------------------------------------------------------------
setInterval(findRemoveSync.bind(this, path.join(__dirname, '/out'), {age: {seconds: 3600}}), 600000);
//setInterval(findRemoveSync.bind(this, path.join(__dirname, '/out'), {age: {seconds: 60}}), 60000);
