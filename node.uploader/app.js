//# -*- mode: javascript; coding: utf-8 -*-

var tempDir = 'Temp';
var targetDir = 'Repo';          // mkdir Temp; mkdir Repo; node app.js
var mbBytes = 1048576;           // bytes in megabyte
//var chunkSize = 8 * mbBytes;    // chunk size in bytes
var chunkSize = 1 * mbBytes;    // chunk size in bytes
var bufMaxSize = 3 * mbBytes;   // storage io buffer
var ipPort = 8080;

var app = require('http').createServer(httpResponder),
    // transports: polling only because of https proxy
    io = require('socket.io').listen(app, {'transports': ['polling']}),
    fs = require('fs'),
    exec = require('child_process').exec,
    util = require('util'),
    os = require('os'),
    filesList = {};

app.listen(ipPort);
// print to stdout with timestamp
util.log(util.format('Server running at http://%s:%s/', os.hostname(), ipPort));
io.sockets.on('connection', onSocketConnect);


function httpResponder(req, res) {
    fs.readFile(__dirname + '/index.html',
        function (err, data) {
            if (err) {
                res.writeHead(500);
                return res.end('Error loading index.html');
            }
            res.writeHead(200);
            res.end(data);
        }
    );
} // function httpResponder(req, res)


function onSocketConnect(socket) {
    socket.on('fileMeta', function(data) {onSocketFileMeta(data, socket);});
    socket.on('fileData', function(data) {onSocketFileData(data, socket);});
} // function onSocketConnect(socket)


function onSocketFileMeta (data, socket) {
    // start recieve file; socket.on('fileMeta' ...
    // data example {Name: "v2.0.png", Size: 337147}
    util.log(util.format('onSocketFileMeta. data: %j', data));
    var fName = data['Name'],
        fSize = data['Size'];
    var fullName = tempDir + '/' + fName;
    // Create a new Entry in The Files List
    var fObj = {
        fSize     : fSize, // file size
        bytesBuf  : '',    // data buffer, 10 MB max
        rcvdBytes : 0,     // count of recieved bytes
        fHandle   : ''     // file handle
    }

    try {
        var stat = fs.statSync(fullName);
        if(stat.isFile()) {
            // if file exist already
            fObj.rcvdBytes = stat.size;
        }
    }
    catch(err) {
        // It's a New File
        console.log("onSocketFileMeta. It's a new file", err);
    }

    filesList[fName] = fObj;
    util.log(util.format('onSocketFileMeta. opening file %s', fullName));
    fs.open(fullName, 'a', 0644,
        function(err, fd) {
            onFileOpen(err, fd, fName, socket);
        }
    );
} // function onSocketFileMeta (data, socket)


function onFileOpen(err, fd, fName, socket) {
    var fObj = filesList[fName];
    if(err) {
        //console.log(err);
        console.log("onFileOpen. File can't be opened/created, check %s dir. ", tempDir, err);
    }
    else {
        // We store the file handler so we can write to it later
        fObj.fHandle = fd;
        filesList[fName] = fObj;
        getNextChunk(fObj, socket);
    }
} // function onFileOpen(err, fd, fName, socket)


function getNextChunk(fObj, socket) {
    var pct = (fObj.rcvdBytes / fObj.fSize) * 100;
    var chunkNum = fObj.rcvdBytes / chunkSize;
    var chunk = { 'ChunkNum' : chunkNum, 'Percent' : pct };
    util.log(util.format('getNextChunk. Ask nextChunk %j', chunk));
    socket.emit('nextChunk', chunk);
} // function getNextChunk(fObj, socket)

function arrayBufferToBuffer(ab) {
    var buffer = new Buffer(ab.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buffer.length; ++i) {
        buffer[i] = view[i];
    }
    return buffer;
}

function onSocketFileData(data, socket) {
    // socket.on('fileData' ...
    var fName = data['Name'];
    var ab = data['Data']; // ArrayBuffer?
    //console.log('onSocketFileData, Data:', ab);
    var blob = '';
    if(Buffer.isBuffer(ab)) {
        console.log("onSocketFileData, Data is Buffer object");
        blob = ab
    }
    else {
        console.log("onSocketFileData, Data is ArrayBuffer object, I think so");
        blob = arrayBufferToBuffer(ab);
    }

    var fObj = filesList[fName];
    fObj.rcvdBytes += ab.length;
    if(Buffer.isBuffer(fObj.bytesBuf))
        fObj.bytesBuf = Buffer.concat([fObj.bytesBuf, blob]);
    else
        fObj.bytesBuf = blob;
    filesList[fName] = fObj;

    if(fObj.rcvdBytes == fObj.fSize) {
        //If File is Fully Uploaded
        console.log("All file bytes was uploaded, write to fs");
        //fs.write(fd, buffer, offset, length[, position], callback)
        fs.write(fObj.fHandle, fObj.bytesBuf, 0, fObj.bytesBuf.length, null,
            function(err, written, buffer) {
                onFileWriteDone(err, written, buffer, fName, socket);
            }
        );
    } // finish
    else if(fObj.bytesBuf.length > bufMaxSize) {
        //If the Data Buffer reaches 10MB
        console.log("Buffer overflow, flush data to fs");
        //fs.write(fd, buffer, offset, length[, position], callback)
        fs.write(fObj.fHandle, fObj.bytesBuf, 0, fObj.bytesBuf.length, null,
            function(err, written, buffer) {
                onFileWriteBuffer(err, written, buffer, fName, socket);
            }
        );
    }
    else {
        getNextChunk(fObj, socket);
    }
} // function onSocketFileData(data, socket)


function onFileWriteDone(err, written, buffer, fName, socket) {
    var fObj = filesList[fName];
    fs.close(fObj.fHandle, function(err) {
        fObj.fHandle = '';
        filesList[fName] = fObj;
    });

    var tempName = tempDir + '/' + fName;
    var repoName = targetDir + '/' + fName;
    fs.rename(tempName, repoName,
        function(err) {
            var msg = '';
            if(err) {
                var msg = util.format('onFileWriteDone. fs.rename error: %j', err);
                console.log(msg);
            }
            var stat = {'Message' : msg, 'Preview' : fName + '.thumbnail.jpg'};
            util.log(util.format('onFileWriteDone. Send status %j', stat));
            socket.emit('fileProcessed', stat);
        }
    );
} // function onFileWriteDone(err, written, buffer, fName, socket)


function onFileWriteBuffer(err, written, buffer, fName, socket) {
    // buffer writed
    var fObj = filesList[fName];
    fObj.bytesBuf = ''; // Reset The Buffer
    filesList[fName] = fObj;
    getNextChunk(fObj, socket);
} // function onFileWriteBuffer(err, written, buffer, fName, socket)
