import React, { useState } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  Space,
  message,
  Alert,
  Divider,
} from "antd";
import { MailOutlined } from "@ant-design/icons";
import type { FormInstance } from "antd";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";

interface LoginModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: (user: any) => void;
  onRegister: () => void;
  onForgotPassword: () => void;
  onDiscordLogin: () => void;
  form: FormInstance;
}

export function LoginModal({
  visible,
  onCancel,
  onSuccess,
  onRegister,
  onForgotPassword,
  onDiscordLogin,
  form,
}: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const { t } = useLocale();

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setError("");

    try {
      // Hash password client-side before sending
      const { PasswordHasher } = await import("../utils/password-hash");
      const passwordHash = PasswordHasher.hashPassword(values.password);

      const response = await fetch(`${basePath}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: values.email,
          passwordHash: passwordHash,
        }),
      });

      const data = await response.json();

      if (data.success) {
        message.success(t.auth.loginSuccess);
        form.resetFields();
        setShowEmailForm(false);
        onSuccess(data.user);
      } else {
        if (data.needsVerification) {
          setError(t.auth.emailNotVerified + " " + t.auth.resendVerification);
        } else if (data.useDiscordLogin) {
          setError(t.auth.useDiscordLogin);
        } else {
          setError(data.error || t.auth.loginFailed);
        }
      }
    } catch (error) {
      console.error("Login error:", error);
      setError(t.auth.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setError("");
    setShowEmailForm(false);
    onCancel();
  };

  const handleDiscordClick = () => {
    handleCancel();
    onDiscordLogin();
  };

  return (
    <Modal
      title={t.auth.login}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      centered
    >
      {error && (
        <Alert
          title={error}
          type="error"
          closable
          onClose={() => setError("")}
          style={{ marginBottom: "16px" }}
        />
      )}

      <div style={{ marginTop: "16px" }}>
        {/* Discord login button */}
        <Button
          size="large"
          block
          onClick={handleDiscordClick}
          icon={
            <svg
              width="20"
              height="15"
              viewBox="0 0 71 55"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              style={{ verticalAlign: "middle" }}
            >
              <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309-0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5473 44.3433C53.9027 44.6363 54.2749 44.9293 54.6499 45.2082C54.7787 45.304 54.7703 45.5041 54.6303 45.5858C52.8616 46.6172 51.0229 47.4931 49.0863 48.2228C48.9598 48.2707 48.9043 48.4172 48.9659 48.5383C50.0327 50.6034 51.2501 52.5699 52.5765 54.435C52.6325 54.5139 52.7332 54.5477 52.8256 54.5195C58.58 52.7249 64.4626 50.0174 70.5355 45.5576C70.5886 45.5182 70.6222 45.459 70.6278 45.3942C72.1116 30.0011 68.1542 16.7074 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1099 30.1693C30.1099 34.1136 27.2799 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8462 37.3253 40.9363 34.1136 40.9363 30.1693C40.9363 26.225 43.763 23.0133 47.3178 23.0133C50.8725 23.0133 53.7543 26.2532 53.7016 30.1693C53.7016 34.1136 50.8725 37.3253 47.3178 37.3253Z" />
            </svg>
          }
          style={{
            backgroundColor: "#5865F2",
            borderColor: "#5865F2",
            color: "white",
            fontWeight: 500,
            height: "48px",
          }}
        >
          {t.auth.continueWithDiscord}
        </Button>

        <Divider style={{ margin: "16px 0" }}>
          <span style={{ color: "#999", fontSize: "13px" }}>{t.common.or}</span>
        </Divider>

        {/* Email login section */}
        {!showEmailForm ? (
          <Button
            size="large"
            block
            icon={<MailOutlined />}
            onClick={() => setShowEmailForm(true)}
            style={{ height: "48px" }}
          >
            {t.auth.signInWithEmail}
          </Button>
        ) : (
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
            <Form.Item
              label={t.auth.password}
              name="password"
              rules={[{ required: true, message: t.auth.passwordRequired }]}
            >
              <Input.Password size="large" placeholder={t.auth.enterPassword} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={loading}
                >
                  {t.auth.signIn}
                </Button>
                <Button type="link" block onClick={onForgotPassword}>
                  {t.auth.forgotPassword}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        )}

        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <span style={{ color: "#666" }}>{t.auth.dontHaveAccount}</span>
          <Button type="link" onClick={onRegister} style={{ padding: "0 8px" }}>
            {t.auth.register}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
