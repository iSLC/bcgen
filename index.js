/* --------------------------------------------------------------------------------------------------------------------
 * Import necessary libraries.
*/
const fs = require('fs');
const path = require('path');
const docx = require("docx");
const crypto = require('crypto');
const express = require('express');
const barcoder = require('barcoder');
const bardcode = require("bardcode");
const bodyParser = require('body-parser');
const PDFMerger = require('pdf-merger-js');
const findRemoveSync = require('find-remove');
const {createCanvas, registerFont, loadImage} = require('canvas');
// --------------------------------------------------------------------------------------------------------------------
const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TabStopPosition, TabStopType, TextRun } = docx;
/* --------------------------------------------------------------------------------------------------------------------
 * Register primary font.
*/
registerFont('unispace.rg.ttf', {family: 'Unispace'});
// --------------------------------------------------------------------------------------------------------------------
const port = 8080;
const app = express();
/* --------------------------------------------------------------------------------------------------------------------
 * Install middle-ware into web-server.
*/
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
/* --------------------------------------------------------------------------------------------------------------------
 * Expose the directory where the files are generated so they can be downloaded.
*/
app.use('/out', express.static(path.join(__dirname, 'out')));
/* --------------------------------------------------------------------------------------------------------------------
 * Main web-server entry point which serves the HTML interface.
*/
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});
/* --------------------------------------------------------------------------------------------------------------------
 * A4 page size in pixels at 300ppi resolution.
*/
const PAGE_W = 2480; // Width
const PAGE_H = 3508; // Height
/* --------------------------------------------------------------------------------------------------------------------
 * Size of a single cell in a 4x10 label grid with no margins.
*/
const CODE_W = Math.round(PAGE_W / 4); // Width
const CODE_H = Math.round(PAGE_H / 10); // Height
/* --------------------------------------------------------------------------------------------------------------------
 * Paint a single label within the specified rectangle.
*/
function GenerateLabel(ctx, t, l, b, r, type, id, color, code, waist, inseam) {
    // Paing outer frame
    ctx.beginPath();
    ctx.moveTo(l + 112, t + 32);
    ctx.lineTo(r - 112, t + 32);
    ctx.lineTo(r - 112, b - 32);
    ctx.lineTo(l + 112, b - 32);
    ctx.lineTo(l + 112, t + 32);
    ctx.closePath();
    ctx.stroke();
    // Paint inner box
    ctx.beginPath();
    ctx.moveTo(r - 160, t + 36);
    ctx.lineTo(r - 160, b - 36);
    ctx.lineTo(l + 256, b - 36);
    ctx.lineTo(l + 256, t + 36);
    ctx.lineTo(r - 160, t + 36);
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
    ctx.translate(r - 132, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${type}`, 0, 20);
    ctx.restore();
    // Paint ID
    ctx.save();
    ctx.font = '24px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 174, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${id}`, 0, 12);
    ctx.restore();
    // Paint #1 Label
    ctx.save();
    ctx.font = '20px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 216, t + 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('Größe', 0, 10);
    ctx.restore();
    // Paint #1 Label
    ctx.save();
    ctx.font = '20px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(r - 216, b - 104);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('Länge', 0, 10);
    ctx.restore();
    // Paint #1
    ctx.save();
    ctx.font = '72px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 344, t + 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${waist}`, 0, 36);
    ctx.restore();
    // Paint #2
    ctx.save();
    ctx.font = '72px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 344, b - 96);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${inseam}`, 0, 36);
    ctx.restore();
    // Paint Color
    ctx.save();
    ctx.font = '24px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 274, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${color}`, 0, 12);
    ctx.restore();
    // Draw bar-code
    bardcode.drawBarcode(ctx, `${code}`, {
        type: 'Code 128',
        x: l + 200,
        y: t + (b - t) / 2,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        angle: 90,
        width: (b - t) - 48
    });
    // Paint bar-code text
    ctx.save();
    ctx.font = '22px "Unispace"';
    ctx.textAlign = 'center';
    ctx.translate(l + 136, t + (b - t) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${code}`, 0, 8);
    ctx.restore();
}
/* --------------------------------------------------------------------------------------------------------------------
 * Generate a random name for a file.
*/
function RandomName(ext) { return `bc.${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`; }
/* --------------------------------------------------------------------------------------------------------------------
 * Web-server entry point which receives input and generates PDF files.
*/
app.post('/pdf', (req, res) => {
    // Check for empty request body
    if (typeof req.body !== 'object' || req.body === null) {
        res.send('@Invalid request body');
        return;
    }
    // Initial file name
    var name = RandomName('pdf');
    // File path
    var fp = path.join('out/', name);
    // File name list
    var file_list = [fp];
    // Create initial canvas
    var canvas = createCanvas(PAGE_W, PAGE_H, 'pdf');
    var ctx = canvas.getContext('2d');
    // Bar-code count, row/column and failure state
    var count = 0, row = 0, col = 0, failed = null;
    // Top/Left/Bottom/Right label rectangle points
    var top = 0, left = 0, bottom = 0, right = 0;
    // Iterate over requested bar-code entries
    req.body.every(function(e, idx) {
        // Amount of bar-codes to create
        var amount = parseInt(e.amount);
        // Break if amount is not valid
        if (!e.amount || amount < 1 || amount > 1000) return !(failed = `@Invalid amount ${amount}`);
        // Fetch label information
        var type = e.type, id = e.id, color = e.color, code = e.code, waist = parseInt(e.waist), inseam = parseInt(e.inseam);
        // Break if information is not valid
        if (!code || code.length != 12 || barcoder.validate(`${code}`)) return !(failed = `@Invalid EAN code ${code}`);
        if (!type || type.length < 1 || type.length > 12) return !(failed = `@Invalid type ${type}`);
        if (!id || id.length < 1 || id.length > 18) return !(failed = `@Invalid id ${id}`);
        if (!color || color.length < 1 || color.length > 18) return !(failed = `@Invalid color ${color}`);
        if (!e.waist || waist < 1 || waist > 99) return !(failed = `@Invalid waist number ${waist}`);
        if (!e.inseam || inseam < 1 || inseam > 99) return !(failed = `@Invalid inseam number ${inseam}`);
        // Generate bar-code labels
        for (var i = 0; i < amount; ++i) {
            // Limit bar-code count
            if (count >= 2000) {
                 return !(failed = `@Article limit reached ${count}`);
            }
            // Span another page if no more room
            if (row == 9 && col == 4) {
                // Write current canvas
                fs.writeFileSync(fp, canvas.toBuffer());
                // New file name
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
            // First row?
            if (row == 0) {
                // Offset first row down to account for printer limits
                top = CODE_H * row + 28;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            // Last row?
            } else if (row == 9) {
                // Offset first row up to account for printer limits
                top = CODE_H * row - 28;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            } else {
                // Compute normal label frame
                top = CODE_H * row;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            }
            // Next column
            ++col;
            // Next bar-code
            ++count;
            // Paint label content
            GenerateLabel(ctx, top, left, bottom, right, type, id, color, code, waist, inseam);
        }
        // Process next one
        return true;
    });
    // Write last canvas
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
/* --------------------------------------------------------------------------------------------------------------------
 * Web-server entry point which receives input and generates Doc files.
*/
app.post('/doc', (req, res) => {
    // Check for empty request body
    if (typeof req.body !== 'object' || req.body === null) {
        res.send('@Invalid request body');
        return;
    }
    // Initial file name
    var name = RandomName('png');
    // File path
    var fp = path.join('out/', name);
    // File name list
    var file_list = [fp];
    // Create initial canvas
    var canvas = createCanvas(PAGE_W, PAGE_H);
    var ctx = canvas.getContext('2d');
    // Bar-code count, row/column and failure state
    var count = 0, row = 0, col = 0, failed = null;
    // Top/Left/Bottom/Right label rectangle points
    var top = 0, left = 0, bottom = 0, right = 0;
    // Iterate over requested bar-code entries
    req.body.every(function(e, idx) {
        // Amount of bar-codes to create
        var amount = parseInt(e.amount);
        // Break if amount is not valid
        if (!e.amount || amount < 1 || amount > 1000) return !(failed = `@Invalid amount ${amount}`);
        // Fetch label information
        var type = e.type, id = e.id, color = e.color, code = e.code, waist = parseInt(e.waist), inseam = parseInt(e.inseam);
        // Break if information is not valid
        if (!code || code.length != 12 || barcoder.validate(`${code}`)) return !(failed = `@Invalid EAN code ${code}`);
        if (!type || type.length < 1 || type.length > 12) return !(failed = `@Invalid type ${type}`);
        if (!id || id.length < 1 || id.length > 18) return !(failed = `@Invalid id ${id}`);
        if (!color || color.length < 1 || color.length > 18) return !(failed = `@Invalid color ${color}`);
        if (!e.waist || waist < 1 || waist > 99) return !(failed = `@Invalid waist number ${waist}`);
        if (!e.inseam || inseam < 1 || inseam > 99) return !(failed = `@Invalid inseam number ${inseam}`);
        // Generate bar-code labels
        for (var i = 0; i < amount; ++i) {
            // Limit bar-code count
            if (count >= 2000) {
                 return !(failed = `@Article limit reached ${count}`);
            }
            // Span another page if no more room
            if (row == 9 && col == 4) {
                // Write current canvas
                fs.writeFileSync(fp, canvas.toBuffer());
                // New file name
                name = RandomName('png');
                // File path
                fp = path.join('out/', name);
                // Append to name list
                file_list.push(fp);
                // Create new canvas
                canvas = createCanvas(PAGE_W, PAGE_H);
                ctx = canvas.getContext('2d');
                // Reset row and column
                row = 0, col = 0;
            }
            // Advance row
            if (col == 4) {
                ++row;
                col=0;
            }
            // First row?
            if (row == 0) {
                // Offset first row down to account for printer limits
                top = CODE_H * row + 28;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            // Last row?
            } else if (row == 9) {
                // Offset first row up to account for printer limits
                top = CODE_H * row - 28;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            } else {
                // Compute normal label frame
                top = CODE_H * row;
                left = CODE_W * col;
                bottom = top + CODE_H;
                right = left + CODE_W;
            }
            // Next column
            ++col;
            // Next bar-code
            ++count;
            // Paint label content
            GenerateLabel(ctx, top, left, bottom, right, type, id, color, code, waist, inseam);
        }
        // Process next one
        return true;
    });
    // Write last canvas
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
        if (count) console.log(`Doc generation failed: ${failed}`);
        // Return reason
        res.send(failed);
        // Stop here
        return;
    // Do we have multiple documents?
    } else if (file_list.length > 0) {
        // Create document
        const doc = new docx.Document({
            description: "Bar-code labels",
            title: "Labels",
        });
        // Add documents to be merged
        file_list.every(function(p, idx) {
            // Load the image into the document
            const image = docx.Media.addImage(doc, fs.readFileSync(p), 794, 1123, {
                floating: {
                    horizontalPosition: {
                        relative: docx.HorizontalPositionRelativeFrom.PAGE,
                        align: docx.HorizontalPositionAlign.LEFT,
                    },
                    verticalPosition: {
                        relative: docx.VerticalPositionRelativeFrom.PAGE,
                        align: docx.VerticalPositionAlign.TOP,
                    },
                    margins: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0
                    }
                }
            });
            // Create a new section with the image
            doc.addSection({
                margins: {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
                width: {
                    size: 100,
                    type: docx.WidthType.PERCENTAGE
                },
                children: [new docx.Paragraph(image)]
            });
            // Next path
            return true;
        });
        // File name
        name = RandomName('docx');
        // File path
        fp = path.join('out/', name);
        // Save document file
        docx.Packer.toBuffer(doc).then((buffer) => {
            fs.writeFileSync(fp, buffer);
        });
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
/* --------------------------------------------------------------------------------------------------------------------
 * Start the web-server on the specified port.
*/
app.listen(port, 'localhost', () => {
    console.log(`Server accessible on port ${port}`);
});
/* --------------------------------------------------------------------------------------------------------------------
 * Remove files after a while.
*/
setInterval(function() {
    findRemoveSync(path.join(__dirname, '/out'), {age: {seconds: 86400}});
}, 86400000);
/*setInterval(function() {
    findRemoveSync(path.join(__dirname, '/out'), {age: {seconds: 60}});
}, 60000);
*/
