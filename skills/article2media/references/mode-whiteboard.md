# 白板模式（-w，`--layout whiteboard`）：把论证过程摊开

白板呈现作者**怎样一步步走到结论**：问题在上，前提、证据、矛盾、转折、局部分支逐层往下，停在内容自身的收束处。读者只看成品，也应能复述"为什么下一步从上一步发生"。它不是摘要——摘要留下结论，最容易删掉抵达结论的过程。

## 流程

```bash
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/article.md --layout whiteboard        # 1. 生成来源清单 whiteboard-source.json
# 2. 你写 <目录>/whiteboard.json（下文）
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/whiteboard.json --layout whiteboard --check   # 3. 只校验账本
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/whiteboard.json --layout whiteboard           # 4. 渲染 → whiteboard/whiteboard.png
```

来源清单由脚本**直接从原文**生成（每段一个 `src-NN` 和哈希），不能由你的账本反推——否则漏掉的段落会和账本一起消失，核对就失去意义。原文在建清单后被改动，渲染会拒绝。

## whiteboard.json

```jsonc
{
  "inventory": "whiteboard-source.json",
  "source_sha256": "清单里的 source_sha256",
  "title": "2027 年\n最赚钱的 AI 生意",
  "question": "读者带着什么问题往下读",
  "orientation": "可选：来源场景，不写结论",
  "source_sections": [                       // 清单里每一段都要处置，顺序与清单一致
    { "id": "src-01", "disposition": "rendered", "step_ids": ["step-01"] },
    { "id": "src-05", "disposition": "omitted", "omission_reason": "作者自家产品推广，不参与论证" }
  ],
  "steps": [
    { "id": "step-01", "role": "question", "source_refs": ["src-01"], "claim": "这一步新增的判断",
      "support": "原文给的事实、解释或限定", "residue": "本步自然留下、推动下一步的未解压力（没有就留空）",
      "structure": { "type": "timeline", "items": [{ "label": "2021", "text": "品牌投给创作者 139 亿美元" }] },
      "learning": { "label": "原文实例", "text": "……" } }
  ],
  "relations": [
    { "id": "rel-01", "from": "step-01", "to": "step-02", "kind": "continue", "visibility": "implicit", "bridge": "" },
    { "id": "rel-02", "from": "step-02", "to": "step-03", "kind": "contrast", "visibility": "visible", "bridge": "一句完整、具体的转折句。" }
  ],
  "closing": "可选：收束句"
}
```

- `role`：question 问题 / premise 前提 / evidence 证据 / tension 矛盾 / inference 推理 / turn 转折 / synthesis 综合 / conclusion 结论 / boundary 边界。描述论证作用，不要把例子一律标成证据。
- `structure`（可选，嵌在步骤里的局部结构）：`chain`（items）、`timeline`（items: label + text）、`branch`（root + items: label + text）、`matrix`（cols + rows: label + cells）、`radial`（center + items）。主干永远只有一条；真实文章可以先递进、再分叉、再汇合。
- `learning`（可选便签）：原文实例、凭什么归类、换个情形；编者补的例子标明「编者补充」，不冒充原文。

## 规则（check 会拦下）

- **每段原文必须有去向**：rendered 指向存在的步骤，或 omitted 写清具体理由（"只是例子"这种笼统理由会被提示）。删除测试两条，任一成立就保留：删了后面的判断失去前提（论证承重）；删了读者认不出概念、分不清易混对象（学习承重）。
- **静默是默认**：普通延续、解释、递进用 `implicit`，bridge 必须为空；只有矛盾、问题改写、分支、回收、边界真正改变阅读方向时才用 `visible`，bridge 写一整句具体的话。不要写"继续追问""再向前一步"这类空泛旁白。
- 同一个转折只说一次：步骤的 `residue` 和随后关系的 `bridge` 二选一。
- 可见转折过多（超过步骤数一半）会被提示。

## 视觉

白板底色加淡网点、霞鹜文楷手写感标题；角色用马克笔颜色区分（红：问题 / 矛盾 / 转折；蓝：前提 / 证据；绿：结论）；可见转折是真实的箭头加一句过渡句；便签黄色。`--theme` 可换成主题配色。图片只嵌在它解释的那一步里（`step.image.src`），删掉不影响理解就不要放。

## 交付

PNG 路径与尺寸；论证账本：几步、几处可见转折；来源几段、几段进入白板、几段省略（理由已写）；重叠切片审片结果（`whiteboard/review/`）。
