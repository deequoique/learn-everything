# Practice Lessons And Resources Design

## Goal

High-difficulty or hands-on lessons should not stop at a lecture note. They should also produce a separate practical lesson with workflow steps, commands, code, validation checks, and troubleshooting. Reference resources should be fetched automatically when a lesson is opened, and course ordering should use numeric code order.

## Chosen Approach

Use existing `Task` rows for practical lessons with `task_type="practice"` and `node_id` set to the lesson. This avoids a schema expansion while giving the UI a separate content surface. Add a "实操课程" tab beside "教学内容", "我的笔记", and "参考资料".

## Behavior

- A lesson is practice-heavy when `difficulty >= 4`, `est_hours >= 3`, or the topic/title/description contains practical keywords such as 微调, fine-tune, 训练, 部署, API, SDK, 数据集, 实操, 项目, 推理, 评估, 代码.
- When course content is generated, the service should also generate a practice lesson for practice-heavy nodes if one does not already exist.
- Users can manually generate or regenerate the practice lesson from the lesson tab.
- When a course is opened and no AI reference resources exist, resource fetching starts in the background and the tab shows an in-progress message.
- Manual "拉取并总结资料" remains available for synchronous generation.
- Course lists and batch generation queues sort codes numerically, so `2.10` comes after `2.9`, not after `2.1`.

## Data Flow

- `learning_ext.progress.study` owns practice detection, numeric code sorting, lesson content generation, and practice task generation.
- `learning_ext.notes.service` continues to own reference-resource recommendation, fetching, summarization, and persistence.
- `learning_ext.pages.study_workbench` renders the new tab, triggers manual practice generation, and starts background resource generation when needed.

## Error Handling

- Practice generation failures should not block lecture-note generation.
- Background reference fetching should log failures and leave the manual button available.
- Existing practice tasks should be reused unless the user explicitly regenerates.

## Testing

- Unit tests cover numeric sort keys and sorted lesson lists.
- Unit tests cover practice-heavy detection and practice task persistence.
- Page tests cover the new tab/button wiring and automatic background resource triggering when a course has no resources.
