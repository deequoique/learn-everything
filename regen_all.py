"""批量重生成所有教学内容 (独立脚本, 后台运行)。

用法: kotaemon/.venv/Scripts/python.exe regen_all.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "kotaemon"))

for k in ("COHERE_API_KEY", "VOYAGE_API_KEY", "MISTRAL_API_KEY", "GOOGLE_API_KEY"):
    os.environ.setdefault(k, "placeholder-key")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from learning_ext.progress.study import (
    generate_node_summary_to_db,
    is_content_valid,
)
from ktem.db.engine import engine
from sqlmodel import Session, select
from learning_ext.db.models import KnowledgeNode, LearningProject
from concurrent.futures import ThreadPoolExecutor, as_completed


def main():
    with Session(engine) as s:
        nodes = s.exec(
            select(KnowledgeNode).order_by(KnowledgeNode.project_id, KnowledgeNode.code)
        ).all()
        proj_topics = {}
        for n in nodes:
            if n.project_id not in proj_topics:
                p = s.get(LearningProject, n.project_id)
                proj_topics[n.project_id] = p.topic if p else ""

    invalid = [n for n in nodes if not is_content_valid(n.description)]
    total = len(invalid)
    print(f"需要重生成: {total} 节 (共 {len(nodes)} 节中)")
    print(f"预计耗时: {total * 45 / 60 / 4:.0f} 分钟 (4并发)")
    print("=" * 50)

    if total == 0:
        print("所有内容已有效, 无需生成")
        return

    done = 0
    success = 0
    fail = 0
    t0 = time.time()

    def gen_one(nid, topic):
        return nid, generate_node_summary_to_db(nid, topic)

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(gen_one, n.id, proj_topics.get(n.project_id, "")): n
            for n in invalid
        }
        for fut in as_completed(futures):
            done += 1
            nid, ok = fut.result()
            if ok:
                success += 1
            else:
                fail += 1
            elapsed = time.time() - t0
            rate = done / elapsed * 60 if elapsed > 0 else 0
            eta = (total - done) / rate if rate > 0 else 0
            print(
                f"[{done}/{total}] node#{nid} {'OK' if ok else 'FAIL'} | "
                f"成功{success} 失败{fail} | {rate:.1f}节/分 | 剩余~{eta:.0f}分"
            )

    print("=" * 50)
    print(
        f"完成! 成功 {success}, 失败 {fail}, 总耗时 {(time.time() - t0) / 60:.1f} 分钟"
    )


if __name__ == "__main__":
    main()
