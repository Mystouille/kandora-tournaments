import React, { useState } from "react";
import { Modal, Form, Input, Button, Space, Alert, Result } from "antd";
import { MailOutlined } from "@ant-design/icons";
import type { FormInstance } from "antd";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";

interface RegisterModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: (user: any) => void;
  form: FormInstance;
}

export function RegisterModal({
  visible,
  onCancel,
  onSuccess,
  form,
}: RegisterModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const { t, locale } = useLocale();

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      // Hash password client-side before sending
      const { PasswordHasher } = await import("../utils/password-hash");
      const passwordValidation = PasswordHasher.validatePassword(
        values.password
      );

      if (!passwordValidation.valid) {
        setError(passwordValidation.message || "Invalid password");
        setLoading(false);
        return;
      }

      const passwordHash = PasswordHasher.hashPassword(values.password);

      const response = await fetch(`${basePath}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: values.firstName,
          lastName: values.lastName || "",
          email: values.email,
          passwordHash: passwordHash,
          locale: locale,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setRegisteredEmail(values.email);
        setSuccess(true);
        form.resetFields();
      } else {
        setError(data.error || "Registration failed");
      }
    } catch (error) {
      console.error("Registration error:", error);
      setError(t.auth.networkError);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setError("");
    setSuccess(false);
    setRegisteredEmail("");
    onCancel();
  };

  const handleGoToLogin = () => {
    setSuccess(false);
    setRegisteredEmail("");
    onSuccess(null);
  };

  return (
    <Modal
      title={success ? null : t.auth.createAccount}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      centered
    >
      {success ? (
        <Result
          icon={<MailOutlined style={{ color: "#1890ff" }} />}
          title={t.auth.checkYourEmail}
          subTitle={t.auth.verificationEmailSent.replace(
            "{email}",
            registeredEmail
          )}
          extra={[
            <Button
              type="primary"
              key="login"
              size="large"
              onClick={handleGoToLogin}
            >
              {t.auth.goToLogin}
            </Button>,
          ]}
        >
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#666", marginBottom: "8px" }}>
              {t.auth.verificationEmailExpiry}
            </p>
            <p style={{ color: "#999", fontSize: "13px" }}>
              {t.auth.didntReceiveEmail}
            </p>
          </div>
        </Result>
      ) : (
        <>
          {error && (
            <Alert
              title={error}
              type="error"
              closable
              onClose={() => setError("")}
              style={{ marginBottom: "16px" }}
            />
          )}

          <Alert
            title={t.auth.limitedAccountTitle}
            description={t.auth.limitedAccountDesc}
            type="warning"
            showIcon
            style={{ marginBottom: "16px", marginTop: "16px" }}
          />

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            style={{ marginTop: "24px" }}
          >
            <Form.Item
              label={t.auth.firstName}
              name="firstName"
              tooltip={t.auth.firstNameTooltip}
              rules={[
                { required: true, message: t.auth.firstNameRequired },
                { min: 2, message: t.auth.firstNameMin },
                { max: 50, message: t.auth.firstNameMax },
              ]}
            >
              <Input size="large" placeholder={t.auth.enterFirstName} />
            </Form.Item>

            <Form.Item
              label={t.auth.lastName}
              name="lastName"
              rules={[{ max: 50, message: t.auth.lastNameMax }]}
            >
              <Input size="large" placeholder={t.auth.enterLastName} />
            </Form.Item>

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
              rules={[
                { required: true, message: t.auth.passwordRequired },
                { min: 6, message: t.auth.passwordMin },
              ]}
            >
              <Input.Password size="large" placeholder={t.auth.enterPassword} />
            </Form.Item>

            <Form.Item
              label={t.auth.confirmPassword}
              name="confirmPassword"
              rules={[
                { required: true, message: t.auth.confirmPasswordRequired },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t.auth.passwordsMismatch));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                placeholder={t.auth.confirmYourPassword}
              />
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
                  {t.auth.createAccount}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
