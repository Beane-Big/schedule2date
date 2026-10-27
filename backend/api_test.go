package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Beane-Big/vibebooth/packages/sdk-go/auth"
	"github.com/golang-jwt/jwt/v5"
)

// testServer 起一个用测试密钥签名的 JWKS，后端用真正的令牌校验器，和装在平台里时走同一条路。
// token 签发带指定功能权限的令牌。
func testServer(t *testing.T) (h http.Handler, token func(name string, perms ...string) string) {
	t.Helper()
	var err error
	store, err = OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": "k1",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(jwks.Close)
	token = func(name string, perms ...string) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": "home-platform", "aud": moduleID, "sub": name, "name": name,
			"menus": []string{"home"}, "perms": perms, "exp": time.Now().Add(time.Minute).Unix(),
		})
		tok.Header["kid"] = "k1"
		s, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	return newHandler(auth.NewVerifier(jwks.URL, moduleID).Middleware), token
}

func call(h http.Handler, method, tok, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/api/schedule2date/schedule", strings.NewReader(body))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSchedulePermissions(t *testing.T) {
	h, token := testServer(t)
	maker, viewer, nobody := token("制作人", "make"), token("查看人", "view"), token("路人")
	doc := `{"version":0,"data":{"shifts":[{"date":"2026-10-01","name":"白4","time":"10:00-18:30","note":""}],"fileName":"a.xlsx","settings":{}}}`

	if rec := call(h, "GET", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("没有令牌应该 401，得到 %d", rec.Code)
	}
	if rec := call(h, "GET", nobody, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("没有权限的人不能查看，得到 %d", rec.Code)
	}
	if rec := call(h, "GET", viewer, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"data":null`) {
		t.Fatalf("还没有班表时应返回 data:null，得到 %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "PUT", viewer, doc); rec.Code != http.StatusForbidden {
		t.Fatalf("只能查看的人不能保存，得到 %d", rec.Code)
	}
	if rec := call(h, "PUT", maker, doc); rec.Code != http.StatusOK {
		t.Fatalf("制作人保存失败：%d %s", rec.Code, rec.Body)
	}
	// 制作人也能查看；查看人看到的是制作人存的那份。
	for _, tok := range []string{maker, viewer} {
		rec := call(h, "GET", tok, "")
		var got Schedule
		json.Unmarshal(rec.Body.Bytes(), &got)
		if rec.Code != http.StatusOK || got.Version != 1 || got.UpdatedBy != "制作人" || !strings.Contains(string(got.Data), "白4") {
			t.Fatalf("查看结果不对：%d %s", rec.Code, rec.Body)
		}
	}
	// 拿旧版本再存一次会冲突，并带回最新的班表。
	rec := call(h, "PUT", maker, doc)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"current"`) {
		t.Fatalf("应该冲突：%d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "PUT", maker, `{"version":1,"data":{"shifts":[{"date":"bad","name":"x"}]}}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("格式不对应该 400，得到 %d", rec.Code)
	}
}
