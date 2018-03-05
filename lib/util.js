class Util {
    constructor() {

    }

    getFilenameExt(filename) {
        if (!filename || (filename.length === 0)) {
            return filename;
        }
        const idx = filename.lastIndexOf('.');
        if (idx >= 0) {
            return filename.substr(idx);
        }
        else {
            return filename;
        }
    }


    filenameNoExt(filename) {
        if (!filename || (filename.length === 0)) {
            return filename;
        }
        const idx = filename.lastIndexOf('.');
        if (idx >= 0) {
            return filename.substr(0, idx);
        }
        else {
            return filename;
        }
    }
}

module.exports = new Util()