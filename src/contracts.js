import { pad } from './util.js';
import { zoneRanges } from './derive.js';

/* 判断契約：Jev に送る質問の文言・選択肢と版。質問の kind はデモ内部の名前（truth・select・grade）。 */
export const RACE_OUTLOOK = { id: 'race-outlook', version: 1, label: 'race-outlook@1',
  questions(D){
    const crit={};
    D.horses.forEach(h=>{crit['h'+pad(h.num)]=`${h.num}番 ${h.name}（${h.frame}枠。直近の過去走で最初のコーナーの位置：${h.past.map(p=>p.firstZone||'不明').join('、')}）`;});
    crit.unclear='stateの情報からは、先頭で通過する馬を特定できない';
    const rn=`${D.race.name}（${D.race.distance||'?'}m）`;
    return {
      lead_horse:{kind:'select',instructions:`このレース ${rn} で、最初のコーナーを先頭で通過する馬を選ぶ。stateの\`horses\`の過去の通過位置と枠、\`race_facts.front_runners\`を根拠にする。根拠が足りない場合は unclear を選ぶ。`,criteria:crit},
      early_lead_battle:{kind:'truth',instructions:`このレース ${rn} では、序盤に2頭以上の馬が先頭を主張し、先行争いが激しくなる。stateの\`race_facts.front_runners\`と各馬の枠を根拠に判断し、それを示す根拠がstateにない場合は偽とする。`},
      pace:{kind:'grade',instructions:`このレース ${rn} の前半のペースを、このクラス・距離の標準と比べて評価する。先行しそうな馬の数と枠、\`race_facts.front_3f_ranking\`の前半3F、馬場状態を根拠にする。根拠が足りない場合は中央の段階（ミドル）とする。`,
        criteria:['スロー：このクラス・距離としては前半が落ち着いた流れ。先行争いが起きず、先行した馬が後半まで止まりにくい',
          'ミドル：このクラス・距離として標準的な流れ。前半と後半の配分に大きな偏りがない',
          'ハイ：このクラス・距離としては前半が速い流れ。先行争いで前半が速くなり、先行した馬が後半に苦しくなる']}
    };
  } };

export const HORSE_POSITION = { id: 'horse-position', version: 1, label: 'horse-position@1',
  questions(D,h,ol){
    const n=D.horses.length,crit={};
    zoneRanges(n).forEach(z=>{crit[z.key]=z.key==='front'?'先頭：1番手で通過する':`${z.label}：${z.from}〜${z.to}番手で通過する`;});
    const who=`\`target\`の馬（${h.num}番 ${h.name}）`;
    const basis=`\`target.recent_races\`の通過位置と枠${ol?'、`race_outlook`の想定展開':''}、\`others\`の先行しそうな馬との位置関係を根拠にする。`;
    return {
      first_corner:{kind:'select',instructions:`${who}は、このレース（${n}頭立て）の最初のコーナーをどの位置で通過するか。${basis}`,criteria:crit},
      last_corner:{kind:'select',instructions:`${who}は、このレース（${n}頭立て）の最後のコーナー（4コーナー）をどの位置で通過するか。${basis}`,criteria:{...crit}}
    };
  } };
