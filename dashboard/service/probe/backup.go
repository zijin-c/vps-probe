package probe

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/service/singleton"
)

// 备份包格式（.tar.gz）：
//   manifest.json   版本、时间、原始路径
//   config.yaml     面板配置（含 agent_secret_key、JWT 密钥等）
//   sqlite.db       数据库快照（服务器/密钥/分组/告警/通知/服务监控/流量记录/用户）
//   probe.yaml      本分支扩展配置
//   probe-state.json 提醒去重状态
//   tsdb/...        可选：监控历史

const (
	backupApp       = "nezha-readonly-probe"
	backupVersion   = 1
	pendingFileName = "restore-pending.tar.gz"
	maxRestoreBytes = 4 << 30 // 解包上限 4GiB，防止压缩炸弹
)

type manifest struct {
	App        string    `json:"app"`
	Version    int       `json:"version"`
	CreatedAt  time.Time `json:"created_at"`
	Dashboard  string    `json:"dashboard_version"`
	ConfigPath string    `json:"config_path"`
	DBPath     string    `json:"db_path"`
	TSDBPath   string    `json:"tsdb_path,omitempty"`
	History    bool      `json:"history"`
}

// Paths 由 main 注入，指向当前进程实际使用的文件。
type Paths struct {
	Config string
	DB     string
}

var paths = Paths{Config: "data/config.yaml", DB: "data/sqlite.db"}

func SetPaths(p Paths) { paths = p }

// WriteBackup 把一份完整备份写入 w。
func WriteBackup(w io.Writer, includeHistory bool) error {
	tmpDB, err := os.CreateTemp(dataDir, ".backup-*.db")
	if err != nil {
		return err
	}
	tmpName := tmpDB.Name()
	tmpDB.Close()
	os.Remove(tmpName) // VACUUM INTO 要求目标不存在
	defer os.Remove(tmpName)
	if err := singleton.DB.Exec("VACUUM INTO ?", tmpName).Error; err != nil {
		return fmt.Errorf("数据库快照失败: %w", err)
	}

	tsdbPath := ""
	if includeHistory && singleton.Conf != nil {
		tsdbPath = singleton.Conf.TSDB.DataPath
	}
	m := manifest{
		App: backupApp, Version: backupVersion, CreatedAt: time.Now(),
		Dashboard: singleton.Version, ConfigPath: paths.Config, DBPath: paths.DB,
		TSDBPath: tsdbPath, History: tsdbPath != "",
	}

	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	mb, _ := json.MarshalIndent(m, "", "  ")
	if err := tarBytes(tw, "manifest.json", mb); err != nil {
		return err
	}
	if err := tarFile(tw, "sqlite.db", tmpName); err != nil {
		return err
	}
	if err := tarFile(tw, "config.yaml", paths.Config); err != nil {
		return err
	}
	for _, name := range []string{"probe.yaml", "probe-state.json"} {
		p := filepath.Join(dataDir, name)
		if _, err := os.Stat(p); err == nil {
			if err := tarFile(tw, name, p); err != nil {
				return err
			}
		}
	}
	if tsdbPath != "" {
		if err := filepath.WalkDir(tsdbPath, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(tsdbPath, p)
			if err := tarFile(tw, "tsdb/"+filepath.ToSlash(rel), p); err != nil {
				// TSDB 文件可能在写入中被合并删除，跳过即可
				log.Printf("PROBE>> 备份跳过 %s: %v", p, err)
			}
			return nil
		}); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

func tarBytes(tw *tar.Writer, name string, b []byte) error {
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(b)), ModTime: time.Now()}); err != nil {
		return err
	}
	_, err := tw.Write(b)
	return err
}

func tarFile(tw *tar.Writer, name, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: st.Size(), ModTime: st.ModTime()}); err != nil {
		return err
	}
	_, err = io.CopyN(tw, f, st.Size())
	return err
}

// BackupFileName 生成带时间戳的备份文件名。
func BackupFileName(now time.Time) string {
	return fmt.Sprintf("probe-backup-%s.tar.gz", now.In(singleton.Loc).Format("20060102-150405"))
}

// BackupToDir 写一份备份到 data/backups 并按 keep 清理旧文件，返回路径。
func BackupToDir(includeHistory bool, keep int) (string, error) {
	dir := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, BackupFileName(time.Now()))
	f, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	if err := WriteBackup(f, includeHistory); err != nil {
		f.Close()
		os.Remove(path + ".tmp")
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return "", err
	}
	pruneBackups(dir, keep)
	return path, nil
}

func pruneBackups(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "probe-backup-") && strings.HasSuffix(e.Name(), ".tar.gz") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keep {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

// ValidateBackup 检查备份包结构是否完整，返回 manifest。
func ValidateBackup(path string) (*manifest, error) {
	var m *manifest
	seen := map[string]bool{}
	err := walkTar(path, func(name string, r io.Reader) error {
		seen[name] = true
		if name == "manifest.json" {
			var mm manifest
			if err := json.NewDecoder(io.LimitReader(r, 1<<20)).Decode(&mm); err != nil {
				return fmt.Errorf("manifest 解析失败: %w", err)
			}
			m = &mm
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if m == nil || m.App != backupApp {
		return nil, errors.New("不是本探针的备份文件")
	}
	if m.Version > backupVersion {
		return nil, fmt.Errorf("备份版本 %d 高于当前程序支持的 %d", m.Version, backupVersion)
	}
	if !seen["sqlite.db"] || !seen["config.yaml"] {
		return nil, errors.New("备份不完整：缺少 sqlite.db 或 config.yaml")
	}
	return m, nil
}

func walkTar(path string, fn func(name string, r io.Reader) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("不是有效的 .tar.gz: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		name := filepath.ToSlash(filepath.Clean(h.Name))
		if strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") || name == ".." {
			return fmt.Errorf("非法路径: %s", h.Name)
		}
		total += h.Size
		if total > maxRestoreBytes {
			return errors.New("备份解包后体积过大")
		}
		if err := fn(name, tr); err != nil {
			return err
		}
	}
}

// PendingRestorePath 返回待恢复文件的位置。
func PendingRestorePath(dir string) string { return filepath.Join(dir, pendingFileName) }

// StagePendingRestore 校验上传的备份并放到待恢复位置，下次启动时应用。
func StagePendingRestore(src string) error {
	if _, err := ValidateBackup(src); err != nil {
		return err
	}
	return os.Rename(src, PendingRestorePath(dataDir))
}

// ApplyRestore 在面板打开数据库之前调用：把备份内容覆盖到当前路径。
// 覆盖前会把现有文件移动到 data/backups/pre-restore-<时间>/，可手动回滚。
func ApplyRestore(archive string, p Paths, dir string) error {
	m, err := ValidateBackup(archive)
	if err != nil {
		return err
	}
	stamp := time.Now().Format("20060102-150405")
	stage := filepath.Join(dir, ".restore-"+stamp)
	if err := os.MkdirAll(stage, 0o700); err != nil {
		return err
	}
	defer os.RemoveAll(stage)

	if err := walkTar(archive, func(name string, r io.Reader) error {
		dst := filepath.Join(stage, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			return err
		}
		f, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		_, err = io.Copy(f, r)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		return err
	}); err != nil {
		return err
	}

	old := filepath.Join(dir, "backups", "pre-restore-"+stamp)
	if err := os.MkdirAll(old, 0o700); err != nil {
		return err
	}
	moves := []struct{ from, to string }{
		{filepath.Join(stage, "sqlite.db"), p.DB},
		{filepath.Join(stage, "config.yaml"), p.Config},
		{filepath.Join(stage, "probe.yaml"), filepath.Join(dir, "probe.yaml")},
		{filepath.Join(stage, "probe-state.json"), filepath.Join(dir, "probe-state.json")},
	}
	if m.History && m.TSDBPath != "" {
		moves = append(moves, struct{ from, to string }{filepath.Join(stage, "tsdb"), m.TSDBPath})
	}
	for _, mv := range moves {
		if _, err := os.Stat(mv.from); err != nil {
			continue
		}
		if _, err := os.Stat(mv.to); err == nil {
			if err := os.Rename(mv.to, filepath.Join(old, filepath.Base(mv.to))); err != nil {
				return fmt.Errorf("备份旧文件 %s 失败: %w", mv.to, err)
			}
		}
		// 旧数据库的 WAL/SHM 必须一并移走，否则会被套用到新库上
		if mv.to == p.DB {
			for _, suf := range []string{"-wal", "-shm", "-journal"} {
				if _, err := os.Stat(p.DB + suf); err == nil {
					_ = os.Rename(p.DB+suf, filepath.Join(old, filepath.Base(p.DB)+suf))
				}
			}
		}
		if err := os.MkdirAll(filepath.Dir(mv.to), 0o700); err != nil {
			return err
		}
		if err := os.Rename(mv.from, mv.to); err != nil {
			return fmt.Errorf("恢复 %s 失败: %w", mv.to, err)
		}
	}
	log.Printf("PROBE>> 已从备份恢复（创建于 %s），旧数据保存在 %s", m.CreatedAt.Format(time.RFC3339), old)
	return nil
}

// ApplyPendingRestore 若存在待恢复文件则应用并删除它。
func ApplyPendingRestore(p Paths, dir string) error {
	pending := PendingRestorePath(dir)
	if _, err := os.Stat(pending); err != nil {
		return nil
	}
	if err := ApplyRestore(pending, p, dir); err != nil {
		bad := pending + ".failed"
		_ = os.Rename(pending, bad)
		return fmt.Errorf("待恢复备份应用失败（已改名为 %s）: %w", bad, err)
	}
	return os.Remove(pending)
}
