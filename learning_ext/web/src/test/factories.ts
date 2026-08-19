import type { CourseNode, Roadmap, RoadmapStage } from "../api/contracts";

export function makeNode(index: number, status = index === 1 ? "learning" : "planned"): CourseNode {
  const stageNumber = index <= 20 ? 1 : index <= 40 ? 2 : 3;
  return { id: `node-${index}`, courseCode: `2.${index}`, title: `学习节点 ${index}`, stageId: `stage-${stageNumber}`, stageTitle: ["基础", "强化", "实战"][stageNumber - 1], status, summary: `第 ${index} 节的学习重点`, description: `第 ${index} 节的描述`, content: index === 50 ? "安全的内容 <script>window.evil = true</script>" : `# 节点 ${index}\n\n这里是第 ${index} 节的正文。`, practice: index % 3 === 0 ? "完成一个小练习。" : null, note: null, resources: [], estimatedMinutes: 30 };
}

export function makeRoadmap(count = 50): Roadmap {
  const nodes = Array.from({ length: count }, (_, index) => makeNode(index + 1));
  const stages: RoadmapStage[] = [1, 2, 3].map((number) => ({ id: `stage-${number}`, title: ["基础", "强化", "实战"][number - 1], nodes: nodes.filter((node) => node.stageId === `stage-${number}`) }));
  return { stages, nodes };
}
