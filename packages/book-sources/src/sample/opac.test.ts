import { describe, expect, it } from 'vitest';
import { parseCallNumbers, pickCallNumber } from './opac';

describe('国图 OPAC 索书号解析', () => {
  it('馆藏列表：按表头找到索书号列', () => {
    const html = `
      <table><tr><td>检索</td></tr></table>
      <table cellspacing=2 border=0 width=100%>
        <tr><th class=text3>单册状态</th><th class=text3>应还日期</th><th class=text3>馆藏地</th><th class=text3>索书号</th><th class=text3>条码</th></tr>
        <tr><td class=td1>阅览</td><td class=td1>&nbsp;</td><td class=td1>中文基藏</td><td class=td1><a href="#">2012\\F069.9-49\\12</a></td><td class=td1>3200</td></tr>
        <tr><td class=td1>外借</td><td class=td1>&nbsp;</td><td class=td1>中文图书借阅区</td><td class=td1>F069.9-49/36</td><td class=td1>3201</td></tr>
      </table>`;
    const values = parseCallNumbers(html);
    expect(values).toEqual(['2012\\F069.9-49\\12', 'F069.9-49/36']);
    expect(pickCallNumber(values)).toBe('2012\\F069.9-49\\12');
  });

  it('书目全记录：“索取号 | 值”两列的行', () => {
    const html = `<table>
      <tr><td class=td1>题名与责任</td><td class=td1>思考，快与慢</td></tr>
      <tr><td class=td1>索取号</td><td class=td1>2012\\F069.9-49\\12</td></tr>
    </table>`;
    expect(parseCallNumbers(html)).toEqual(['2012\\F069.9-49\\12']);
  });

  it('没有索书号时返回空', () => {
    expect(parseCallNumbers('<table><tr><th>题名</th></tr><tr><td>思考</td></tr></table>')).toEqual(
      [],
    );
    expect(pickCallNumber([])).toBeUndefined();
  });
});
