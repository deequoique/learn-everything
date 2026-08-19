import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Brain, Check, RotateCcw } from "lucide-react";
import { api, reviewKeys } from "../../api/client";
import { EmptyState, ErrorState, LoadingState } from "../../components/AsyncState";
import { SectionHeader } from "../../components/SectionHeader";

const ratings = [{ value: 1, label: "忘记", hint: "需要重来" }, { value: 2, label: "困难", hint: "想起来了" }, { value: 3, label: "一般", hint: "需要巩固" }, { value: 4, label: "熟练", hint: "下次更晚" }];

export function ReviewPage() {
  const stats = useQuery({ queryKey: reviewKeys.stats, queryFn: api.reviewStats });
  const next = useQuery({ queryKey: reviewKeys.next, queryFn: api.nextReview });
  const [showAnswer, setShowAnswer] = useState(false);
  const queryClient = useQueryClient();
  const rate = useMutation({ mutationFn: ({ id, rating }: { id: string; rating: number }) => api.rateReview(id, rating), onSuccess: (data) => { setShowAnswer(false); queryClient.setQueryData(reviewKeys.next, data.next ?? null); void queryClient.invalidateQueries({ queryKey: reviewKeys.stats }); } });
  useEffect(() => { setShowAnswer(false); }, [next.data?.id]);
  if (stats.isPending || next.isPending) return <div className="page-inner"><LoadingState label="正在准备复习卡片" /></div>;
  if (stats.isError || next.isError) return <div className="page-inner"><ErrorState message={(stats.error ?? next.error)?.message ?? "复习暂时不可用"} onRetry={() => { void stats.refetch(); void next.refetch(); }} /></div>;
  const card = next.data;
  return <div className="page-inner"><SectionHeader eyebrow="Review · 间隔复习" title="把记忆留住" description="先回答，再判断这次回忆的难度。评分会安排下一次见面的时间。" action={<Link className="button button-quiet" to="/dashboard">查看学习进度 <ArrowRight size={15} /></Link>} /><div className="review-layout"><section className="card review-card">{card ? <><div className="eyebrow">今日第 {stats.data.reviewedToday + 1} 张 · {card.sourceTitle ?? "学习卡片"}</div><div className="review-prompt">{card.prompt}</div>{showAnswer ? <div className="review-answer"><div className="eyebrow">答案</div><p style={{ marginTop: 8 }}>{card.answer}</p></div> : <button className="button button-secondary" type="button" style={{ marginTop: 28 }} onClick={() => setShowAnswer(true)}>查看答案 <ArrowRight size={15} /></button>}{showAnswer && <div className="rating-row">{ratings.map((rating) => <button className="rating-button" key={rating.value} type="button" onClick={() => rate.mutate({ id: card.id, rating: rating.value })} disabled={rate.isPending}><strong>{rating.value} · {rating.label}</strong><span>{rating.hint}</span></button>)}</div>}</> : <EmptyState title="今天没有待复习内容" message="新的卡片会按照记忆节奏再次出现。现在可以继续课程，或者回顾学习进度。" action={<div className="form-actions"><Link className="button" to="/courses"><Brain size={15} />继续课程</Link><Link className="button button-quiet" to="/dashboard">看进度</Link></div>} />}</section><aside className="today-side"><section className="card today-card"><div className="eyebrow">记忆状态</div><div className="stat-list" style={{ marginTop: 15 }}><div className="stat-item"><span>待复习</span><strong>{stats.data.due}</strong></div><div className="stat-item"><span>学习中</span><strong>{stats.data.learning}</strong></div><div className="stat-item"><span>已掌握</span><strong>{stats.data.mastered}</strong></div></div></section><section className="card today-card"><div className="eyebrow">一个小提醒</div><h3>评分不是考试</h3><p>诚实告诉系统你需要多少帮助，下一次间隔才会更适合你。</p><div className="inline-note"><Check size={15} />每次复习都会留下轨迹</div></section>{card && <button className="button button-quiet" type="button" onClick={() => { void next.refetch(); setShowAnswer(false); }}><RotateCcw size={14} />重新载入卡片</button>}</aside></div></div>;
}
