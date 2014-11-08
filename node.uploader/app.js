//# -*- mode: javascript; coding: utf-8 -*-

var tempDir = 'Temp';
var targetDir = 'Repo';          // mkdir Temp; mkdir Repo; node app.js
var mbBytes = 1048576;           // bytes in megabyte
var chunkSize = 3 * mbBytes;     // chunk size in bytes
var bufMaxSize = 10485760;       // 10 MB

var app = require('http').createServer(httpResponder),
    io = require('socket.io').listen(app),
    fs = require('fs'),
    exec = require('child_process').exec,
    util = require('util'),
    filesList = {};

app.listen(8080); // http://servername:8080/
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
        console.log(err);
    }

    filesList[fName] = fObj;
    fs.open(fullName, 'a', 0644, function(err, fd) {onFileOpen(err, fd, fName, socket);});
} // function onSocketFileMeta (data, socket)


function onFileOpen(err, fd, fName, socket) {
    var fObj = filesList[fName];
    if(err) {
        console.log(err);
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
    socket.emit('nextChunk', { 'ChunkNum' : chunkNum, 'Percent' : pct });
} // function getNextChunk(fObj, socket)


function onSocketFileData(data, socket) {
    // socket.on('fileData' ...
    var fName = data['Name'];
    var blob = data['Data']

    var fObj = filesList[fName];
    fObj.rcvdBytes += blob.length;
    fObj.bytesBuf += blob;
    filesList[fName] = fObj;

    if(fObj.rcvdBytes == fObj.fSize) {
        //If File is Fully Uploaded
        fs.write(fObj.fHandle, fObj.bytesBuf, null, 'Binary',
            function(err, written, buffer) {
                onFileWriteDone(err, written, buffer, fName, socket);
            }
        );
    } // finish
    else if(fObj.bytesBuf.length > bufMaxSize) {
        //If the Data Buffer reaches 10MB
        fs.write(fObj.fHandle, fObj.bytesBuf, null, 'Binary',
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

    // TODO: move file from temp to repo
    //~ fs.rename("Temp/" + Name, "Video/" + Name,
        //~ function() {
            //~ fs.unlink("Temp/" + Name,
                //~ function () {
                    //~ console.log("unlink this file:",Name );
                    //~ socket.emit('Done', {'Image' : 'Video/' + Name + '.jpg'});
                //~ }
            //~ );
        //~ }
    //~ );

    var tempName = tempDir + '/' + fName;
    var inp = fs.createReadStream(tempName);
    var out = fs.createWriteStream(targetDir + '/' + fName);
    util.pump(inp, out,
        function() {
            fs.unlink(tempName,
                function () {
                socket.emit('fileProcessed', {'Preview' : 'thumbnail.jpg'});
                //exec("ffmpeg -i Video/" + Name  + " -ss 01:30 -r 1 -an -vframes 1 -f mjpeg Video/" + Name  + ".jpg", function(err){
                //  socket.emit('Done', {'Image' : 'Video/' + Name + '.jpg'});
                //});
                }
            );
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
