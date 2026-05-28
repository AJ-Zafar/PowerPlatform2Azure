import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true
});

const stripUtf8Bom = (xml: string): string =>
  xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;

export const parseXmlDocument = (xml: string): unknown =>
  (() => {
    const sanitized = stripUtf8Bom(xml);
    const validationResult = XMLValidator.validate(sanitized);

    if (validationResult !== true) {
      throw new Error(validationResult.err.msg);
    }

    return parser.parse(sanitized);
  })();
