# 更接近人类的绘画过程：论文调研与实施建议

调研日期：2026-10-16。基于论文摘要、作者项目页与官方仓库说明；未逐篇阅读全文 PDF，也未在本机运行这些模型。本文是方案评估，本次没有修改绘图引擎。

## 结论

可以明显改善当前的机械感。近期最适合的是改造笔触规划：从粗到细、顺着图像结构运笔、持续比较当前画布与目标图，只在需要的地方补画，并集中处理一个局部。

“成品相似”“动作像手绘”“顺序像画师”是三个不同目标。重建误差很低，并不代表过程合理；从一张成品也不能唯一恢复作者真实的绘画历史。产品应称为生成一种合理的重绘过程。

## 已核实的相关研究

| 工作 | 核心方法及输出 | 对本项目的价值与限制 |
| --- | --- | --- |
| Hertzmann, *Painterly Rendering with Curved Brush Strokes of Multiple Sizes*, SIGGRAPH 1998 | 多尺度样条笔触；先大笔，再小笔；当前画面与模糊参考图不一致时才补画；长曲线沿图像梯度的法向延伸 | 最适合先借鉴，不需要训练模型。能改善笔触方向与无效补色，但不能识别人脸、头发等语义，也不保证真人顺序 |
| *Learning to Paint with Model-based Deep Reinforcement Learning*, ICCV 2019 | 神经渲染器与强化学习，学习位置、颜色等动作，用数百笔重建图像 | 可研究笔数控制与下一笔选择。训练不依赖真人笔触轨迹，因此不能把其输出当作真人行为学习成果 |
| *Paint Transformer: Feed Forward Neural Painting with Stroke Prediction*, ICCV 2021 | Transformer 前馈预测笔触参数集合；合成数据自训练 | 可作为笔触规划后端候选，接入现有逐笔播放器。并行预测不等于自然的人类顺序；官方动画输出需串行推理。论文的速度不能直接套用本机 |
| *Stylized Neural Painting*, CVPR 2021 | 借助可微神经渲染器优化笔触参数，支持不同笔刷及保存笔触文件 | 比视频模型更适合保留逐笔、色号与暂停功能。官方有 CPU 模式，但本机速度未知；绘画风格和细线还原需验证。仓库许可为 CC BY-NC-SA 4.0，商业复用需另核实授权 |
| *ProcessPainter: Learn Painting Process from Sequence Data*, arXiv 2024 | 合成绘画序列预训练，再以真实画师序列做 LoRA 微调；支持参考图约束 | 更贴近“学习人如何画”。输出图像帧/视频，并非可执行笔触。官方仓库要求单次推理至少 30GB 显存；代码和权重已发布，训练数据未发布 |
| *PaintsAlter: Generating Past and Future in Digital Painting Processes*, SIGGRAPH 2025；相关前作 PaintsUndo | 生成数字绘画过去/未来的过程，呈现草稿、修改与上色等变化 | 适合参考宏观过程。输出仍是视频，不直接给轨迹、笔压、色号。PaintsUndo 有实现；不能据此前作仓库认定 PaintsAlter 完整实现已发布 |

### 原始资料

1. Hertzmann：[作者页面与摘要](https://mrl.cs.nyu.edu/publications/painterly98/)，[论文 PDF](https://mrl.cs.nyu.edu/publications/painterly98/hertzmann-siggraph98.pdf)。
2. Learning to Paint：[论文](https://arxiv.org/abs/1903.04411)，[官方实现](https://github.com/hzwer/ICCV2019-LearningToPaint)。
3. Paint Transformer：[CVF 论文页面](https://openaccess.thecvf.com/content/ICCV2021/html/Liu_Paint_Transformer_Feed_Forward_Neural_Painting_With_Stroke_Prediction_ICCV_2021_paper.html)，[官方 Paddle 实现](https://github.com/wzmsltw/PaintTransformer)。Huage001/PaintTransformer 是非官方 PyTorch 实现。
4. Stylized Neural Painting：[项目页](https://jiupinjia.github.io/neuralpainter/)，[论文](https://arxiv.org/abs/2011.08114)，[官方实现与许可说明](https://github.com/jiupinjia/stylized-neural-painting)。
5. ProcessPainter：[论文](https://arxiv.org/abs/2406.06062)，[官方仓库及显存要求](https://github.com/nicolaus-huang/ProcessPainter)，[权重](https://huggingface.co/nicolaus-huang/ProcessPainter)。
6. PaintsAlter：[作者项目页与论文链接](https://lllyasviel.github.io/paints_alter_web/)；PaintsUndo：[官方仓库](https://github.com/lllyasviel/Paints-UNDO)，[过程示例](https://lllyasviel.github.io/pages/paints_undo/)。PaintsUndo 仓库报告在 24GB RTX 4090/3090Ti 测试，每图约 5–10 分钟，这是作者报告，非本机实测。

## 当前项目的问题

当前实现是图像处理与规则规划，不是从画师记录学习的模型。它对图片做颜色归并、连通区域和轮廓提取，再生成草稿、线稿、底色、调色、细节、修边等阶段的路径。平滑模式还会把笔触裁剪在颜色区域内。

这些阶段主要依据面积、亮度、密度等规则划分，尚不能真正判断“这里是头发”“这里需要补一笔反光”。区域被切得过碎时，路径容易变成许多短小的覆盖动作，裁剪边界还会造成一笔自动贴合复杂轮廓的观感。

现有 sample-fill.json 有 70,678 笔，其中细节 32,059 笔、修边 32,867 笔。后两阶段占约 92%。这些是本项目样例统计，不代表所有上传图片。单纯延长每笔播放时间无法解决规划碎片化。

## 推荐实施顺序

### 第一阶段：在浏览器算法中改进笔触

主要修改 src/runtime/engine.js 与 src/runtime/fill-brush-plan.js，保留现有播放器、色号、记录和移动端界面。

1. **粗到细的目标图。** 先针对低分辨率/模糊目标建立大色调，逐级提高细节目标。大笔铺色仍需显示连续路径增长，不把整块颜色一次显现。
2. **沿结构画曲线。** 使用梯度和结构张量估计局部方向，沿轮廓或纹理方向延伸曲线；颜色突变、方向急转或笔触过长时收笔。平坦区域没有可靠方向时，沿用当前局部的运笔方向。
3. **按画布误差补画。** 每批笔触完成后比较画布和当前尺度的目标，只为明显残差生成候选笔触。细化时避免给每个小色块机械分配若干笔。
4. **集中处理局部。** 将邻近且相关的区域组成工作范围，排序同时考虑残差、距离、换色和局部完成度。允许必要的跨区回看，不要求一个区域彻底完成才离开。
5. **限制不可能的笔触。** 笔迹应由连续轨迹、笔宽和压力形成。限制依赖精细遮罩自动雕刻轮廓的效果；修边也通过可见的较细路径完成。
6. **明确结束条件。** 当残差已小，或继续补画收益很低时停止，避免高光阶段累积几万笔微小动作。

以上是结合论文与项目问题提出的工程方案，不是声称某篇论文已完整解决全部问题。结构方向不能代替物体语义；要稳定做到“先画头发，再画脸”，之后仍需语义分割、用户区域标注或学习型规划器。

### 第二阶段：验证学习型笔触规划

用 Paint Transformer 或 Stylized Neural Painting 做小规模离线对照。先测试用户插画的色块、线条与细节能否保住，再决定是否接入。将模型笔触参数转换为现有播放器动作，验证排序与笔刷兼容性；不预设它们会比当前方法更像真人。

如采用模型，可保持 Web 前端和 Node 服务入口，将模型运行封装为独立后端服务。用户使用网页，无需手动启动 Python；但算力和部署依赖仍然存在。

### 第三阶段：真实过程数据

ProcessPainter、PaintsAlter 的主要启发是学习真实过程的阶段、局部停留和修改行为。若产品需要可执行笔触，应采集或使用获得授权的轨迹、笔刷、笔压、颜色、图层及时间数据，训练下一笔或区域规划器。视频帧转换成可信的笔触记录还需额外研究，不能直接把视频帧当成真实落笔。

## 算力与验证

本次系统检查只识别到 Intel 核显和虚拟显示适配器，未发现 nvidia-smi；未验证可用 NVIDIA CUDA 环境。因此优先做无需神经网络推理的第一阶段。不据显卡 AdapterRAM 字段推断实际可用显存。

验证应在相近的最终还原度下，用同一张用户插画、项目样例和简单平涂图比较：

- 总笔数、细节阶段笔数、跨区域跳跃和换色次数。
- 是否看得见连续运笔，而不是区域显现或细碎覆盖。
- 草稿、铺色、局部细化的中间截图是否合理。
- 用户对过程自然度的判断，尤其避免扫描行、网格和随机点画。
- 手机解析时间、播放流畅度、内存占用，以及残差是否正常收敛。

不能只以最终图片相似度作为成功标准，也不能以笔数越少越好。需要同时保住原图结构、动作可理解性和设备性能。
