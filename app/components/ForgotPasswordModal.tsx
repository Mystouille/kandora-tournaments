import React, { useState } from "react";
import { Modal, Form, Input, Button, Alert, Result } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";

interface ForgotPasswordModalProps {
  visible: boolean;
  onCancel: () => void;
  onBackToLogin: () => void;
}

export function ForgotPasswordModal({
  visible,
  onCancel,
  onBackToLogin,
}: ForgotPasswordModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [form] = Form.useForm();
  const { t } = useLocale();

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${basePath}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });

      const data = await response.json();

      if (data.success) {
        setSent(true);
      } else {
        setError(data.error || t.auth.networkError);
      }
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(t.auth.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setError("");
    setSent(false);
    onCancel();
  };

  const handleBackToLogin = () => {
    form.resetFields();
    setError("");
    setSent(false);
    onBackToLogin();
  };

  return (
    <Modal
      title={t.auth.forgotPasswordTitle}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      centered
    >
      {sent ? (
        <Result
          icon={<MailOutlined style={{ color: "#1890ff" }} />}
          title={t.auth.resetLinkSent}
          subTitle={t.auth.resetLinkSentDesc}
          extra={
            <Button type="primary" onClick={handleBackToLogin}>
              {t.auth.backToLogin}
            </Button>
          }
        />
      ) : (
        <>
          <p style={{ color: "#666", marginBottom: "24px" }}>
            {t.auth.forgotPasswordDesc}
          </p>

          {error && (
            <Alert
              title={error}
              type="error"
              closable
              onClose={() => setError("")}
              style={{ marginBottom: "16px" }}
            />
          )}

          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item
              label={t.auth.email}
              name="email"
              rules={[
                { required: true, message: t.auth.emailRequired },
                { type: "email", message: t.auth.emailInvalid },
              ]}
            >
              <Input size="large" placeholder={t.auth.enterEmail} />
            </Form.Item>

            <Form.Item style={{ marginBottom: "8px" }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
              >
                {t.auth.sendResetLink}
              </Button>
            </Form.Item>

            <div style={{ textAlign: "center" }}>
              <Button type="link" onClick={handleBackToLogin}>
                {t.auth.backToLogin}
              </Button>
            </div>
          </Form>
        </>
      )}
    </Modal>
  );
}
