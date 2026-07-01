import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { MahjongTileExtension } from "./MahjongTileExtension";
import { MahjongHandExtension } from "./MahjongHandExtension";
import { VideoExtension } from "./VideoExtension";
import { EmbedExtension, parseEmbedUrl } from "./EmbedExtension";
import { splitHandTiles } from "../mahjong/TileDisplay";
import { useState, useEffect, useRef } from "react";
import type { InputRef } from "antd";
import {
  Button,
  Input,
  Modal,
  Space,
  Tooltip,
  Divider,
  Upload,
  message,
} from "antd";
import {
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  PictureOutlined,
  LinkOutlined,
  UndoOutlined,
  RedoOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  uploadImage,
  uploadImageFromUrl,
  uploadVideo,
} from "../../utils/uploadImage";
import { useLocale } from "../../contexts/LocaleContext";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  /**
   * Optional z-index applied to every Modal opened by the
   * toolbar (tile/hand/image/link/video pickers). Defaults to
   * antd's `1000`; bump it when the editor is rendered inside
   * a host that uses a higher stacking context (e.g. the replay
   * canvas wrapper sits at `z-[9999]`, which would otherwise
   * occlude the modals).
   */
  modalZIndex?: number;
}

export function RichTextEditor({
  content,
  onChange,
  modalZIndex,
}: RichTextEditorProps) {
  const { t } = useLocale();
  const te = t.news.admin.editor;
  const [tileModalOpen, setTileModalOpen] = useState(false);
  const [handModalOpen, setHandModalOpen] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [tileInput, setTileInput] = useState("");
  const [handInput, setHandInput] = useState("");
  const [handLabelInput, setHandLabelInput] = useState("");
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [videoUploading, setVideoUploading] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const tileInputRef = useRef<InputRef>(null);
  const handInputRef = useRef<InputRef>(null);

  const editor = useEditor({
    // This app renders with SSR enabled (`ssr: true`). TipTap v3 requires
    // `immediatelyRender: false` so the editor/view is created on the client
    // instead of during the server render — otherwise ProseMirror serializes
    // against a not-yet-initialized schema and throws
    // "Cannot read properties of null (reading 'cached')".
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
        link: {
          openOnClick: false,
        },
      }),
      Image,
      MahjongTileExtension,
      MahjongHandExtension,
      VideoExtension,
      EmbedExtension,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = content || "";
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    const el = editorWrapperRef.current;
    if (!el || !editor) {
      return;
    }

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) {
        return;
      }
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length === 0) {
        return;
      }
      e.preventDefault();
      for (const file of imageFiles) {
        uploadImage(file)
          .then((url) => {
            editor.chain().focus().setImage({ src: url }).run();
          })
          .catch(() => {
            message.error("Image upload failed");
          });
      }
    };

    el.addEventListener("paste", handlePaste);
    return () => {
      el.removeEventListener("paste", handlePaste);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  const insertTile = () => {
    const tiles = splitHandTiles(tileInput.trim());
    if (tiles.length > 0) {
      editor
        .chain()
        .focus()
        .insertContent(
          tiles.map((t) => ({ type: "mahjongTile", attrs: { tile: t } }))
        )
        .run();
    }
    setTileModalOpen(false);
    setTileInput("");
    // antd Modal restores focus to its trigger button on close;
    // override that on the next tick so typing continues in the
    // editor rather than on the toolbar button.
    requestAnimationFrame(() => editor.commands.focus());
  };

  const insertHand = () => {
    if (handInput.trim()) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "mahjongHand",
          attrs: { hand: handInput.trim(), label: handLabelInput.trim() },
        })
        .run();
    }
    setHandModalOpen(false);
    setHandInput("");
    setHandLabelInput("");
    // See `insertTile` for why we re-focus on the next frame.
    requestAnimationFrame(() => editor.commands.focus());
  };

  const insertImage = async () => {
    const url = imageUrlInput.trim();
    if (!url) {
      return;
    }
    setImageUploading(true);
    try {
      const localUrl = await uploadImageFromUrl(url);
      editor.chain().focus().setImage({ src: localUrl }).run();
      setImageModalOpen(false);
      setImageUrlInput("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to download image"
      );
    } finally {
      setImageUploading(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    try {
      const url = await uploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
      setImageModalOpen(false);
      setImageUrlInput("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
    }
  };

  const insertLink = () => {
    if (linkUrlInput.trim()) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrlInput.trim() })
        .run();
    }
    setLinkModalOpen(false);
    setLinkUrlInput("");
  };

  const insertVideoFromUrl = () => {
    const url = videoUrlInput.trim();
    if (!url) {
      return;
    }
    const parsed = parseEmbedUrl(url);
    if (parsed) {
      editor.chain().focus().setEmbed({ url }).run();
    } else {
      // Treat as a direct video file URL
      editor.chain().focus().setVideo({ src: url }).run();
    }
    setVideoModalOpen(false);
    setVideoUrlInput("");
  };

  const handleVideoUpload = async (file: File) => {
    setVideoUploading(true);
    try {
      const url = await uploadVideo(file);
      editor.chain().focus().setVideo({ src: url }).run();
      setVideoModalOpen(false);
      setVideoUrlInput("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setVideoUploading(false);
    }
  };

  return (
    <div className="rich-text-editor">
      <div
        style={{
          borderBottom: "1px solid #d9d9d9",
          padding: "4px 8px",
          display: "flex",
          flexWrap: "wrap",
          gap: 2,
          alignItems: "center",
        }}
      >
        <Space.Compact>
          <Tooltip title="Bold">
            <Button
              size="small"
              type={editor.isActive("bold") ? "primary" : "default"}
              icon={<BoldOutlined />}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
          </Tooltip>
          <Tooltip title="Italic">
            <Button
              size="small"
              type={editor.isActive("italic") ? "primary" : "default"}
              icon={<ItalicOutlined />}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
          </Tooltip>
          <Tooltip title="Strikethrough">
            <Button
              size="small"
              type={editor.isActive("strike") ? "primary" : "default"}
              icon={<StrikethroughOutlined />}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
          </Tooltip>
        </Space.Compact>

        <Divider type="vertical" />

        <Space.Compact>
          <Tooltip title="Heading 2">
            <Button
              size="small"
              type={
                editor.isActive("heading", { level: 2 }) ? "primary" : "default"
              }
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleHeading({ level: 2 }).run();
              }}
            >
              H2
            </Button>
          </Tooltip>
          <Tooltip title="Heading 3">
            <Button
              size="small"
              type={
                editor.isActive("heading", { level: 3 }) ? "primary" : "default"
              }
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleHeading({ level: 3 }).run();
              }}
            >
              H3
            </Button>
          </Tooltip>
        </Space.Compact>

        <Divider type="vertical" />

        <Space.Compact>
          <Tooltip title="Bullet List">
            <Button
              size="small"
              type={editor.isActive("bulletList") ? "primary" : "default"}
              icon={<UnorderedListOutlined />}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
          </Tooltip>
          <Tooltip title="Ordered List">
            <Button
              size="small"
              type={editor.isActive("orderedList") ? "primary" : "default"}
              icon={<OrderedListOutlined />}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
          </Tooltip>
        </Space.Compact>

        <Divider type="vertical" />

        <Space.Compact>
          <Tooltip title="Image">
            <Button
              size="small"
              icon={<PictureOutlined />}
              onClick={() => setImageModalOpen(true)}
            />
          </Tooltip>
          <Tooltip title={te.insertVideo}>
            <Button
              size="small"
              icon={<VideoCameraOutlined />}
              onClick={() => setVideoModalOpen(true)}
            />
          </Tooltip>
          <Tooltip title="Link">
            <Button
              size="small"
              icon={<LinkOutlined />}
              onClick={() => setLinkModalOpen(true)}
            />
          </Tooltip>
        </Space.Compact>

        <Divider type="vertical" />

        <Space.Compact>
          <Tooltip title={te.insertTilesTitle}>
            <Button size="small" onClick={() => setTileModalOpen(true)}>
              🀄 {te.insertTiles}
            </Button>
          </Tooltip>
          <Tooltip title={te.insertHandTitle}>
            <Button size="small" onClick={() => setHandModalOpen(true)}>
              🀄 {te.insertHand}
            </Button>
          </Tooltip>
        </Space.Compact>

        <Divider type="vertical" />

        <Space.Compact>
          <Tooltip title="Undo">
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={() => editor.chain().focus().undo().run()}
            />
          </Tooltip>
          <Tooltip title="Redo">
            <Button
              size="small"
              icon={<RedoOutlined />}
              onClick={() => editor.chain().focus().redo().run()}
            />
          </Tooltip>
        </Space.Compact>
      </div>

      <div ref={editorWrapperRef}>
        <EditorContent editor={editor} className="rich-text-editor-content" />
      </div>

      {/* Tile Modal */}
      <Modal
        title={te.insertTilesTitle}
        open={tileModalOpen}
        onOk={insertTile}
        onCancel={() => setTileModalOpen(false)}
        afterOpenChange={(open) => {
          if (open) {
            tileInputRef.current?.focus();
          }
        }}
        width={320}
        zIndex={modalZIndex}
        focusTriggerAfterClose={false}
      >
        <Input
          ref={tileInputRef}
          placeholder={te.insertTilesPlaceholder}
          value={tileInput}
          onChange={(e) => setTileInput(e.target.value)}
          onPressEnter={insertTile}
        />
        <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
          {te.insertTilesHint}
        </div>
      </Modal>

      {/* Hand Modal */}
      <Modal
        title={te.insertHandTitle}
        open={handModalOpen}
        onOk={insertHand}
        onCancel={() => setHandModalOpen(false)}
        afterOpenChange={(open) => {
          if (open) {
            handInputRef.current?.focus();
          }
        }}
        width={400}
        zIndex={modalZIndex}
        focusTriggerAfterClose={false}
      >
        <Input
          ref={handInputRef}
          placeholder={te.insertHandPlaceholder}
          value={handInput}
          onChange={(e) => setHandInput(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Input
          placeholder={te.insertHandLabelPlaceholder}
          value={handLabelInput}
          onChange={(e) => setHandLabelInput(e.target.value)}
          onPressEnter={insertHand}
        />
        <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
          {te.insertHandHint}
        </div>
      </Modal>

      {/* Image Modal */}
      <Modal
        title={te.insertImage}
        open={imageModalOpen}
        onOk={insertImage}
        onCancel={() => {
          setImageModalOpen(false);
          setImageUrlInput("");
        }}
        okText={imageUploading ? te.downloading : te.insertFromUrl}
        okButtonProps={{
          disabled: !imageUrlInput.trim() || imageUploading,
          loading: imageUploading,
        }}
        width={400}
        zIndex={modalZIndex}
      >
        <div style={{ marginBottom: 12 }}>
          <Upload
            accept="image/jpeg,image/png,image/gif,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              handleImageUpload(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={imageUploading} block>
              {te.uploadImage}
            </Button>
          </Upload>
        </div>
        <Divider style={{ margin: "8px 0" }}>{te.orPasteUrl}</Divider>
        <Input
          placeholder={te.imageUrl}
          value={imageUrlInput}
          onChange={(e) => setImageUrlInput(e.target.value)}
          onPressEnter={insertImage}
          disabled={imageUploading}
        />
      </Modal>

      {/* Link Modal */}
      <Modal
        title={te.insertLinkTitle}
        open={linkModalOpen}
        onOk={insertLink}
        onCancel={() => setLinkModalOpen(false)}
        width={400}
        zIndex={modalZIndex}
      >
        <Input
          placeholder="https://..."
          value={linkUrlInput}
          onChange={(e) => setLinkUrlInput(e.target.value)}
          onPressEnter={insertLink}
        />
        <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
          {te.insertLinkHint}
        </div>
      </Modal>

      {/* Video Modal */}
      <Modal
        title={te.insertVideo}
        open={videoModalOpen}
        onOk={insertVideoFromUrl}
        onCancel={() => {
          setVideoModalOpen(false);
          setVideoUrlInput("");
        }}
        okText={te.insertFromUrl}
        okButtonProps={{
          disabled: !videoUrlInput.trim() || videoUploading,
        }}
        width={420}
        zIndex={modalZIndex}
      >
        <div style={{ marginBottom: 12 }}>
          <Upload
            accept="video/mp4,video/webm,video/ogg,video/quicktime"
            showUploadList={false}
            beforeUpload={(file) => {
              handleVideoUpload(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={videoUploading} block>
              {te.uploadVideo}
            </Button>
          </Upload>
          <div style={{ marginTop: 6, color: "#888", fontSize: 12 }}>
            {te.uploadVideoHint}
          </div>
        </div>
        <Divider style={{ margin: "8px 0" }}>{te.orPasteUrl}</Divider>
        <Input
          placeholder={te.videoUrlPlaceholder}
          value={videoUrlInput}
          onChange={(e) => setVideoUrlInput(e.target.value)}
          onPressEnter={insertVideoFromUrl}
          disabled={videoUploading}
        />
        <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
          {te.videoUrlHint}
        </div>
      </Modal>
    </div>
  );
}
