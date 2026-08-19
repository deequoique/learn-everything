import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Server, ShieldCheck } from "lucide-react";
import { api } from "../../api/client";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { SectionHeader } from "../../components/SectionHeader";

export function SettingsPage() {
  const status = useQuery({ queryKey: ["config", "status"], queryFn: api.configStatus });
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

  useEffect(() => {
    if (!status.data) return;
    setProvider(status.data.provider === "openai-compatible" ? "openai" : status.data.provider || "openai");
    setModel(status.data.chatModel || status.data.model || "gpt-4o-mini");
    setEmbeddingModel(status.data.embeddingModel || "");
    setBaseUrl(status.data.baseUrl || "");
  }, [status.data]);

  const test = useMutation({
    mutationFn: api.testConfig,
    onSuccess: (result) => setMessage({ tone: result.ok ? "success" : "error", text: result.message }),
    onError: (error) => setMessage({ tone: "error", text: error.message }),
  });
  const save = useMutation({
    mutationFn: api.saveConfig,
    onSuccess: (result) => {
      setMessage({ tone: "success", text: "模型设置已保存，新的生成和问答会立即使用它。" });
      setApiKey("");
      queryClient.setQueryData(["config", "status"], result);
    },
    onError: (error) => setMessage({ tone: "error", text: error.message }),
  });

  if (status.isPending) return <div className="page-inner"><LoadingState label="正在检查模型连接" /></div>;
  if (status.isError) return <div className="page-inner"><ErrorState message={status.error.message} onRetry={() => void status.refetch()} /></div>;

  const input = {
    provider,
    model,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    embeddingModel: embeddingModel || undefined,
  };
  const canSave = Boolean(apiKey || status.data.configured);
  const canTest = Boolean(apiKey || status.data.configured);

  return (
    <div className="page-inner">
      <SectionHeader
        eyebrow="Settings · 模型配置"
        title="连接你的学习引擎"
        description="密钥只会发送给本地服务保存，不会回显到页面、浏览器存储或日志中。"
        action={<Link className="button button-quiet" to="/help">需要帮助？ <ArrowRight size={15} /></Link>}
      />
      <div className="settings-layout">
        <section className="card card-pad">
          <div className="settings-status">
            <div className={`connection-mark ${status.data.configured ? "ready" : ""}`}><Server size={22} /></div>
            <div>
              <div className="eyebrow">当前状态</div>
              <h3>{status.data.configured ? "AI 已连接" : "还没有连接 AI"}</h3>
              <p>{status.data.configured ? `${status.data.provider ?? provider} · ${status.data.model ?? model}` : "连接后才能生成学习路线和回答问题。"}</p>
            </div>
            <span className={`status-badge ${status.data.configured ? "completed" : "planned"}`}>{status.data.configured ? "可用" : "待配置"}</span>
          </div>
          <div className="form-stack settings-form">
            <div className="form-field">
              <label htmlFor="provider">服务商</label>
              <select id="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="openai">OpenAI 兼容接口</option>
                <option value="deepseek">DeepSeek</option>
                <option value="moonshot">Moonshot</option>
                <option value="custom">自定义服务商</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="model">对话模型</label>
              <input id="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 gpt-4o-mini" />
            </div>
            <div className="form-field">
              <label htmlFor="api-key">API 密钥</label>
              <div className="input-with-action">
                <KeyRound size={15} />
                <input id="api-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.data.configured ? "已保存；留空会继续使用原密钥" : "sk-…"} autoComplete="new-password" />
                <button className="icon-button" type="button" aria-label={showKey ? "隐藏密钥" : "显示密钥"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              <small>页面只知道密钥是否已配置，不会读取已保存的密钥。</small>
            </div>
            <details className="advanced-settings">
              <summary>高级模型设置</summary>
              <div className="advanced-settings-fields">
                <div className="form-field">
                  <label htmlFor="base-url">接口地址</label>
                  <input id="base-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="留空使用服务商默认地址" />
                </div>
                <div className="form-field">
                  <label htmlFor="embedding-model">Embedding 模型</label>
                  <input id="embedding-model" value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} placeholder="例如 text-embedding-3-small" />
                  <small>资料检索只有在这里配置真实可用的 embedding 模型后才会启用。</small>
                </div>
              </div>
            </details>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={() => test.mutate(input)} disabled={!canTest || test.isPending}>{test.isPending ? "正在测试…" : "测试连接"}</button>
              <button className="button" type="button" onClick={() => save.mutate(input)} disabled={!canSave || save.isPending}>{save.isPending ? "正在保存…" : "保存设置"}</button>
            </div>
            {message && <div className={`form-message ${message.tone}`} role="status">{message.tone === "success" ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}{message.text}</div>}
          </div>
        </section>
        <aside className="today-side">
          <section className="card card-pad">
            <div className="eyebrow">已启用能力</div>
            <div className="capability-list">{(status.data.capabilities.length ? status.data.capabilities : ["路线生成", "知识问答", "学习内容准备"]).map((capability) => <div key={capability}><CheckCircle2 size={14} color="var(--mint)" /><span>{capability}</span></div>)}</div>
          </section>
          <section className="card card-pad">
            <div className="eyebrow">本地隐私</div>
            <h3 className="settings-side-title">数据留在你的设备</h3>
            <p className="muted small settings-side-copy">课程、笔记和密钥都由本地服务管理。前端只保存当前项目选择，不保存敏感配置。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
