import { describe, expect, it } from "vitest";
import { parseJsonValue } from "./input";
import { renderJsonTreeHtml } from "./render";

describe("renderJsonTreeHtml", () => {
  it("renders objects and arrays as collapsible details with escaped values", () => {
    const value = parseJsonValue(
      '{"name":"Ada <dev>","tags":["a","b"],"active":true,"score":null}',
    );
    const html = renderJsonTreeHtml(value);
    expect(html).toContain('class="jwb-root"');
    expect(html).toContain("<details");
    expect(html).toContain("2 items");
    expect(html).toContain('<span class="jwb-key">&quot;name&quot;</span>');
    expect(html).toContain("Ada &lt;dev&gt;");
    expect(html).toContain('<span class="jwb-bool">true</span>');
    expect(html).toContain('<span class="jwb-null">null</span>');
    expect(html).not.toContain("<script");
  });

  it("preserves lossless numbers exactly", () => {
    const value = parseJsonValue('{"id":900719925474099312345}');
    const html = renderJsonTreeHtml(value);
    expect(html).toContain("900719925474099312345");
  });

  it("renders empty containers inline", () => {
    expect(renderJsonTreeHtml(parseJsonValue("[]"))).toContain(
      '<span class="jwb-punc">[]</span>',
    );
    expect(renderJsonTreeHtml(parseJsonValue("{}"))).toContain(
      '<span class="jwb-punc">{}</span>',
    );
  });
});
