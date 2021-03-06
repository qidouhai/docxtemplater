const FileTypeConfig = require("../file-type-config.js");
const XmlTemplater = require("../xml-templater");
const path = require("path");
const Docxtemplater = require("../docxtemplater.js");
const DocUtils = Docxtemplater.DocUtils;
const chai = require("chai");
const expect = chai.expect;
const JSZip = require("jszip");
const xmlPrettify = require("./xml-prettify");
const fs = require("fs");
const _ = require("lodash");
let countFiles = 1;
let allStarted = false;
let examplesDirectory;

/* eslint-disable no-console */

function createXmlTemplaterDocx(content, options) {
	options = options || {};
	options.fileTypeConfig = FileTypeConfig.docx;
	Object.keys(DocUtils.defaults).forEach((key) => {
		const defaultValue = DocUtils.defaults[key];
		options[key] = (options[key] != null) ? options[key] : defaultValue;
	});
	options.modules = options.fileTypeConfig.baseModules.map(function (moduleFunction) {
		const module = moduleFunction();
		module.optionsTransformer({}, options);
		return module;
	});

	return new XmlTemplater(content, options)
		.setTags(options.tags)
		.parse();
}

function shouldBeSame(options) {
	const zip = options.doc.getZip();
	const expectedName = options.expectedName;
	let expectedZip;
	const writeFile = path.resolve(examplesDirectory, "..", expectedName);

	if (fs.writeFileSync) {
		fs.writeFileSync(
			writeFile,
			zip.generate({type: "nodebuffer", compression: "DEFLATE"})
		);
	}

	try {
		expectedZip = docX[expectedName].zip;
	}
	catch (e) {
		console.log(JSON.stringify({msg: "Expected name does not match", expectedName}));
		throw e;
	}

	try {
		Object.keys(zip.files).map(function (filePath) {
			const suffix = `for "${filePath}"`;
			expect(zip.files[filePath].name).to.be.equal(expectedZip.files[filePath].name, `Name differs ${suffix}`);
			expect(zip.files[filePath].options.dir).to.be.equal(expectedZip.files[filePath].options.dir, `IsDir differs ${suffix}`);
			const text1 = zip.files[filePath].asText().replace(/\n|\t/g, "");
			const text2 = expectedZip.files[filePath].asText().replace(/\n|\t/g, "");
			if (text1 !== text2 && filePath.indexOf(".png") === -1) {
				const pText1 = xmlPrettify(text1, options);
				const pText2 = xmlPrettify(text2, options);
				expect(pText1).to.be.equal(pText2, `Content differs ${suffix} lengths: "${text1.length}", "${text2.length}"`);
			}
			else {
				expect(text1.length).to.be.equal(text2.length, `Content differs ${suffix}`);
			}
		});
	}
	catch (e) {
		console.log(JSON.stringify({msg: "Expected name does not match", expectedName}));
		throw e;
	}
}

function checkLength(e, expectedError, propertyPath) {
	const propertyPathLength = propertyPath + "Length";
	const property = _.get(e, propertyPath);
	const expectedPropertyLength = _.get(expectedError, propertyPathLength);
	if (property && expectedPropertyLength) {
		expect(expectedPropertyLength).to.be.a("number", JSON.stringify(expectedError.properties));
		expect(expectedPropertyLength).to.equal(property.length);
		_.unset(e, propertyPath);
		_.unset(expectedError, propertyPathLength);
	}
}

function cleanError(e, expectedError) {
	delete e.properties.explanation;
	if (expectedError.properties.offset != null) {
		expect(e.properties.offset).to.be.deep.equal(expectedError.properties.offset);
	}
	delete e.properties.offset;
	delete expectedError.properties.offset;
	e = _.omit(e, ["line", "sourceURL", "stack"]);
	if (e.properties.postparsed) {
		e.properties.postparsed.forEach(function (p) {
			delete p.lIndex;
			delete p.offset;
		});
	}
	if (e.properties.rootError) {
		expect(e.properties.rootError, JSON.stringify(e.properties)).to.be.instanceOf(Error);
		expect(expectedError.properties.rootError, JSON.stringify(expectedError.properties)).to.be.instanceOf(Object);
		if (expectedError) {
			expect(e.properties.rootError.message).to.equal(expectedError.properties.rootError.message);
		}
		delete e.properties.rootError;
		delete expectedError.properties.rootError;
	}
	checkLength(e, expectedError, "properties.paragraphParts");
	checkLength(e, expectedError, "properties.postparsed");
	if (e.stack && expectedError) {
		expect(e.stack).to.contain("Error: " + expectedError.message);
	}
	delete e.stack;
	return e;
}

function wrapMultiError(error) {
	const type = Object.prototype.toString.call(error);
	let errors;
	if (type === "[object Array]") {
		errors = error;
	}
	else {
		errors = [error];
	}

	return {
		name: "TemplateError",
		message: "Multi error",
		properties: {
			id: "multi_error",
			errors,
		},
	};
}

function expectToThrow(fn, type, expectedError) {
	let e = null;
	try {
		fn();
	}
	catch (error) {
		e = error;
	}
	expect(e, "No error has been thrown").not.to.be.equal(null);
	const toShowOnFail = e.stack;
	expect(e, toShowOnFail).to.be.instanceOf(Error);
	expect(e, toShowOnFail).to.be.instanceOf(type);
	expect(e, toShowOnFail).to.be.an("object");
	expect(e, toShowOnFail).to.have.property("properties");
	expect(e.properties, toShowOnFail).to.be.an("object");
	expect(e.properties, toShowOnFail).to.have.property("explanation");
	expect(e.properties.explanation, toShowOnFail).to.be.a("string");
	expect(e.properties, toShowOnFail).to.have.property("id");
	expect(e.properties.id, toShowOnFail).to.be.a("string");
	expect(e.properties.explanation, toShowOnFail).to.be.a("string");
	e = cleanError(e, expectedError);
	if (e.properties.errors) {
		const msg = "expected : \n" + JSON.stringify(expectedError.properties.errors) + "\nactual : \n" + JSON.stringify(e.properties.errors);
		expect(expectedError.properties.errors).to.be.an("array", msg);
		expect(e.properties.errors.length).to.equal(expectedError.properties.errors.length, msg);
		e.properties.errors = e.properties.errors.map(function (e, i) {
			return cleanError(e, expectedError.properties.errors[i]);
		});
	}
	expect(JSON.parse(JSON.stringify(e))).to.be.deep.equal(expectedError);
}

const docX = {};
const imageData = {};

function load(name, content, fileType, obj) {
	const zip = new JSZip(content);
	obj[name] = new Docxtemplater();
	obj[name].loadZip(zip);
	obj[name].loadedName = name;
	obj[name].loadedContent = content;
	return obj[name];
}
function loadDocument(name, content) {
	return load(name, content, "docx", docX);
}
function loadImage(name, content) {
	imageData[name] = content;
}

function loadFile(name, callback) {
	countFiles += 1;
	if (fs.readFileSync) {
		const path = require("path");
		const buffer = fs.readFileSync(path.join(examplesDirectory, name), "binary");
		callback(name, buffer);
		return endLoadFile(-1);
	}
	return JSZipUtils.getBinaryContent("../examples/" + name, function (err, data) {
		if (err) {
			throw err;
		}
		callback(name, data);
		return endLoadFile(-1);
	});
}
function endLoadFile(change) {
	change = change || 0;
	countFiles += change;
	if (countFiles === 0 && allStarted === true) {
		return startFunction();
	}
}

function start() {
	allStarted = true;
	endLoadFile(-1);
}

let startFunction;
function setStartFunction(sf) {
	allStarted = false;
	countFiles = 1;
	startFunction = sf;
}
function setExamplesDirectory(ed) {
	examplesDirectory = ed;
}

function removeSpaces(text) {
	return text.replace(/\n|\t/g, "");
}

function makeDocx(name, content) {
	const zip = new JSZip();
	zip.file("word/document.xml", content);
	const base64 = zip.generate({type: "string"});
	return load(name, base64, "docx", docX);
}

function createDoc(name) {
	return loadDocument(name, docX[name].loadedContent);
}

module.exports = {
	cleanError,
	createXmlTemplaterDocx,
	createDoc,
	loadDocument,
	loadImage,
	shouldBeSame,
	imageData,
	loadFile,
	start,
	chai,
	expect,
	setStartFunction,
	setExamplesDirectory,
	expectToThrow,
	removeSpaces,
	wrapMultiError,
	makeDocx,
};
