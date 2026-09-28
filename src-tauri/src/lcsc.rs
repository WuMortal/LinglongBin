//! 立创商城（szlcsc.com）物料查询
//!
//! 用于 BOM 未匹配行：按立创编号（C 码）联网拉取物料详情，补齐名称/型号/品牌/封装/参数等。
//! 页面数据在 `<script id="__NEXT_DATA__">` 内，命中反爬（203 + 验证页）时需用 RC4 生成校验 Cookie 重试。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

const SEARCH_URL: &str = "https://so.szlcsc.com/global.html";
const VERIFY_KEY: &str = "tg09It3*9h";
const VERIFY_TOKENS: [&str; 4] = ["_xvasu", "_xvtsc", "_xvpfs", "_xvpts"];
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
/// 立创附件域名：fileTypeVOList 里的 fileUrl 是相对路径（/upload/public/pdf/...），需拼在此域名后
const ATTA_HOST: &str = "https://atta.szlcsc.com";
/// 从规格参数中识别封装的键
const PACKAGE_KEYS: [&str; 8] = [
    "封装",
    "封装规格",
    "商品封装",
    "安装类型",
    "Package",
    "Package / Case",
    "Case",
    "Footprint",
];

/// 立创物料附件（数据手册 / 认证资料 / 行业资讯）
#[derive(Serialize, Clone)]
pub struct LcscFile {
    /// 展示名（可能为空，前端按类型兜底）
    pub name: String,
    /// 绝对地址（相对路径已补全为 atta.szlcsc.com 外链）
    pub url: String,
    /// pdf_property 数据手册 / certification_data_property 认证资料 / industry_information 行业资讯
    pub file_type: String,
}

/// 立创物料详情（返回给前端，用于填充补建草稿）
#[derive(Serialize)]
pub struct LcscComponent {
    pub part_no: String,
    pub name: String,
    pub model: Option<String>,
    pub brand: Option<String>,
    pub package: Option<String>,
    pub category: Option<String>,
    /// 分类编码：productVO.productTypeCode（如 "439"），对应本地分类表的 lcsc_id
    pub category_code: Option<String>,
    pub description: Option<String>,
    pub source_url: Option<String>,
    pub image_url: Option<String>,
    /// 规格参数（key, value），保持原始顺序
    pub params: Vec<(String, String)>,
    /// 附件列表（数据手册排在最前），一个物料常有多个
    pub files: Vec<LcscFile>,
}

/// 搜索结果条目（精简：不含规格参数，选中后再按编号查详情）
#[derive(Serialize)]
pub struct LcscHit {
    pub part_no: String,
    pub name: String,
    pub model: Option<String>,
    pub brand: Option<String>,
    pub package: Option<String>,
    pub category: Option<String>,
    /// 分类编码：productVO.productTypeCode（如 "439"），对应本地分类表的 lcsc_id
    pub category_code: Option<String>,
    pub image_url: Option<String>,
    /// 立创现货库存
    pub stock: Option<i64>,
    /// 最低阶梯单价（元）
    pub price: Option<f64>,
    pub source_url: Option<String>,
    /// 附件列表（数据手册排在最前），选用后一并写入物料
    pub files: Vec<LcscFile>,
}

/// 按立创编号查询物料详情
#[tauri::command]
pub async fn lcsc_lookup(part_no: String) -> Result<LcscComponent, String> {
    let code = part_no.trim().to_uppercase();
    if !is_lcsc_code(&code) {
        return Err("不是有效的立创编号（形如 C17710）".into());
    }

    let client = build_client()?;
    let list = fetch_product_list(&client, &code).await?;
    // eprintln!(" list: {:?}",list);

    for record in list.iter() {
        let product = record.get("productVO").cloned().unwrap_or(Value::Null);
        let product_code = html_text(product.get("productCode")).unwrap_or_default();
        if product_code.to_uppercase() != code {
            continue;
        }
        return Ok(build_component(&code, record, &product));
    }

    Err(format!("立创商城未找到编号 {}", code))
}

/// 按型号/关键词搜索立创商城，返回候选列表（编号或型号精确匹配者排前）
#[tauri::command]
pub async fn lcsc_search(keyword: String, limit: Option<usize>) -> Result<Vec<LcscHit>, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Err("搜索关键词为空".into());
    }

    let client = build_client()?;
    let list = fetch_product_list(&client, kw).await?;

    // eprintln!(" list: {:?}",list);

    let max = limit.unwrap_or(20).clamp(1, 50);
    let kw_upper = kw.to_uppercase();
    let mut hits: Vec<LcscHit> = Vec::new();

    for record in list.iter() {
        let product = record.get("productVO").cloned().unwrap_or(Value::Null);
        let code = html_text(product.get("productCode")).unwrap_or_default();
        if code.is_empty() {
            continue;
        }

        let params = parse_params(record.get("paramLinkedMap"));
        let model = html_text(record.get("lightProductModel"))
            .or_else(|| html_text(product.get("productModel")));
        let brand = html_text(record.get("lightBrandName"))
            .or_else(|| html_text(product.get("productGradePlateName")));
        let category = html_text(record.get("lightCatalogName"))
            .or_else(|| html_text(product.get("productType")));
        // 分类编码：用于精确匹配本地分类表的 lcsc_id（比名称模糊匹配可靠）
        let category_code = html_text(product.get("productTypeCode"));
        let package = html_text(record.get("lightStandard"))
            .or_else(|| html_text(product.get("encapsulationModel")))
            .or_else(|| extract_package(&params));

        let raw_name = html_text(record.get("lightProductName"))
            .or_else(|| html_text(product.get("productName")));
        let name = model
            .clone()
            .or_else(|| normalize_display_name(raw_name.clone(), category.clone(), &params))
            .or(raw_name)
            .unwrap_or_default();

        hits.push(LcscHit {
            part_no: code,
            name,
            model,
            brand,
            package,
            category,
            category_code,
            image_url: html_text(product.get("breviaryImageUrl")),
            stock: product.get("stockNumber").and_then(|v| v.as_i64()),
            price: product
                .get("productPriceList")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|p| p.get("productPrice"))
                .and_then(|v| v.as_f64()),
            source_url: html_text(product.get("productId"))
                .map(|id| format!("https://item.szlcsc.com/{}.html", id)),
            files: parse_files(&product),
        });

        if hits.len() >= max {
            break;
        }
    }

    if hits.is_empty() {
        return Err(format!("立创商城未找到「{}」相关的商品", kw));
    }

    // 编号或型号与关键词完全一致的排在前面
    hits.sort_by_key(|h| {
        let exact = h.part_no.to_uppercase() == kw_upper
            || h.model.as_deref().map(|m| m.to_uppercase()) == Some(kw_upper.clone());
        u8::from(!exact)
    });

    Ok(hits)
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 请求立创搜索页并返回商品记录列表（命中反爬验证页时用校验 Cookie 重试一次）
async fn fetch_product_list(client: &reqwest::Client, keyword: &str) -> Result<Vec<Value>, String> {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("k", keyword)
        .finish();
    let url = format!("{}?{}", SEARCH_URL, query);

    let mut resp = get(client, &url, None)
        .await
        .map_err(|e| format!("请求立创失败: {}", e))?;

    if resp.status().as_u16() == 203 {
        let body = resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;
        if !looks_like_verification_page(&body) {
            return Err("立创返回异常状态码 203".into());
        }
        let cookie = build_verification_cookie(&body)
            .ok_or_else(|| "立创返回反爬验证页，未能生成校验 Cookie".to_string())?;
        resp = get(client, &url, Some(cookie))
            .await
            .map_err(|e| format!("重试请求失败: {}", e))?;
    }

    if !resp.status().is_success() {
        return Err(format!("立创返回状态码 {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let json_text =
        extract_next_data(&html).ok_or("未找到 __NEXT_DATA__，立创页面结构可能已变更")?;
    let root: Value = serde_json::from_str(json_text)
        .map_err(|e| format!("解析 __NEXT_DATA__ 失败: {}", e))?;

    root.pointer("/props/pageProps/soData/searchResult/productRecordList")
        .and_then(|v| v.as_array())
        .cloned()
        .ok_or_else(|| "响应中没有商品列表".to_string())
}

/// 下载立创图片到程序 resource 目录 images/lcsc/<随机>.<ext>，返回相对路径（存 materials.image_path）。
/// 图片域名必须为 szlcsc.com / lcsc.com，带 Referer 否则 403。
#[tauri::command]
pub async fn lcsc_fetch_image(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "无效的图片地址".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if !host.ends_with("szlcsc.com") && !host.ends_with("lcsc.com") {
        return Err(format!("非立创图片地址: {}", host));
    }

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let resp = client
        .get(url)
        .header("Referer", "https://www.szlcsc.com/")
        .send()
        .await
        .map_err(|e| format!("下载图片失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载图片返回状态码 {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取图片失败: {}", e))?;
    if bytes.is_empty() {
        return Err("下载到的图片为空".into());
    }

    let ext = parsed
        .path()
        .rsplit('.')
        .next()
        .map(|s| s.to_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
        .unwrap_or_else(|| "png".to_string());
    let rel = format!("images/lcsc/{}.{}", uuid::Uuid::new_v4(), ext);

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    let full = resource_dir.join(&rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&full, &bytes).map_err(|e| format!("写入图片失败: {}", e))?;
    Ok(rel)
}

async fn get(
    client: &reqwest::Client,
    url: &str,
    cookie: Option<String>,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut req = client
        .get(url)
        .header("Referer", "https://so.szlcsc.com/")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        );
    if let Some(c) = cookie {
        req = req.header("Cookie", c);
    }
    req.send().await
}

fn is_lcsc_code(code: &str) -> bool {
    code.len() >= 2
        && code.starts_with('C')
        && code[1..].chars().all(|c| c.is_ascii_digit())
}

/// 从搜索结果的一条记录构造物料详情
fn build_component(code: &str, record: &Value, product: &Value) -> LcscComponent {
    let params = parse_params(record.get("paramLinkedMap"));

    let model = html_text(record.get("lightProductModel"))
        .or_else(|| html_text(product.get("productModel")));
    let brand = html_text(record.get("lightBrandName"))
        .or_else(|| html_text(product.get("productGradePlateName")));
    let category = html_text(record.get("lightCatalogName"))
        .or_else(|| html_text(product.get("productType")));
    // 分类编码：用于精确匹配本地分类表的 lcsc_id（比名称模糊匹配可靠）
    let category_code = html_text(product.get("productTypeCode"));
    let description = html_text(product.get("remark"))
        .or_else(|| html_text(record.get("lightProductIntro")));
    let package = html_text(record.get("lightStandard"))
        .or_else(|| html_text(product.get("encapsulationModel")))
        .or_else(|| extract_package(&params));

    let raw_name = html_text(record.get("lightProductName"))
        .or_else(|| html_text(product.get("productName")));
    let name = model
        .clone()
        .or_else(|| normalize_display_name(raw_name.clone(), category.clone(), &params))
        .or(raw_name)
        .unwrap_or_default();

    let source_url = html_text(product.get("productId"))
        .map(|id| format!("https://item.szlcsc.com/{}.html", id));

    LcscComponent {
        part_no: code.to_string(),
        name,
        model,
        brand,
        package,
        category,
        category_code,
        description,
        source_url,
        image_url: html_text(product.get("breviaryImageUrl")),
        params,
        files: parse_files(product),
    }
}

/// 名称兜底：从商品名中剔除已提取的参数值，避免名称里重复堆参数
fn normalize_display_name(
    raw_name: Option<String>,
    fallback: Option<String>,
    params: &[(String, String)],
) -> Option<String> {
    let raw = raw_name?;
    let mut candidate = raw;
    let mut values: Vec<&str> = params
        .iter()
        .map(|(_, v)| v.as_str())
        .filter(|v| !v.is_empty())
        .collect();
    values.sort_by_key(|v| std::cmp::Reverse(v.len()));
    for v in values {
        candidate = candidate.replace(v, " ");
    }
    let cleaned: String = candidate.split_whitespace().collect::<Vec<&str>>().join(" ");
    if cleaned.is_empty() {
        fallback
    } else {
        Some(cleaned)
    }
}

/// 取字符串字段：去 HTML 标签（搜索结果带 `<em>` 高亮）、压缩空白
fn html_text(v: Option<&Value>) -> Option<String> {
    let raw = match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return None,
    };
    let t = strip_html_tags(&raw);
    let t = t.trim();
    if t.is_empty() || t == "null" {
        None
    } else {
        Some(t.to_string())
    }
}

fn strip_html_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<&str>>().join(" ")
}

fn parse_params(v: Option<&Value>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(Value::Object(map)) = v {
        for (k, val) in map {
            let key = strip_html_tags(k).trim().to_string();
            if let Some(value) = html_text(Some(val)) {
                if !key.is_empty() {
                    out.push((key, value));
                }
            }
        }
    }
    out
}

/// 附件类型的展示优先级：数据手册 → 行业资讯 → 认证资料（未知名类型排最后）
fn file_type_order(t: &str) -> u8 {
    match t {
        "pdf_property" => 0,
        "industry_information" => 1,
        "certification_data_property" => 2,
        _ => 9,
    }
}

/// 相对路径补成立创附件绝对地址（如 /upload/public/pdf/source/xxx.pdf）
fn absolutize_file_url(u: String) -> String {
    if u.starts_with("http://") || u.starts_with("https://") {
        return u;
    }
    if u.starts_with('/') {
        return format!("{}{}", ATTA_HOST, u);
    }
    format!("{}/{}", ATTA_HOST, u)
}

/// 文件名清洗：去掉重复叠加的 .pdf 后缀（立创偶有 xxx.pdf.pdf.pdf）
fn clean_file_name(raw: &str) -> String {
    let mut out = raw.trim().to_string();
    while out.len() > 8 && out.to_lowercase().ends_with(".pdf.pdf") {
        out.truncate(out.len() - 4);
    }
    out
}

/// 提取商品附件（数据手册 / 认证资料 / 行业资讯），数据手册排在最前。
/// 结构：productVO.fileTypeVOList[] → { fileType, detailVOList[] → { fileName, fileUrl, linkAddress } }
fn parse_files(product: &Value) -> Vec<LcscFile> {
    let mut out: Vec<LcscFile> = Vec::new();
    let groups = match product.get("fileTypeVOList").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return out,
    };

    for g in groups {
        let file_type = html_text(g.get("fileType")).unwrap_or_default();
        let details = match g.get("detailVOList").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => continue,
        };
        for d in details {
            // 外链优先（linkAddress），其次相对路径（fileUrl）
            let url = html_text(d.get("linkAddress"))
                .or_else(|| html_text(d.get("fileUrl")).map(absolutize_file_url))
                .unwrap_or_default();
            if url.is_empty() {
                continue;
            }
            let name = html_text(d.get("fileName"))
                .map(|s| clean_file_name(&s))
                .unwrap_or_default();
            out.push(LcscFile { name, url, file_type: file_type.clone() });
        }
    }

    out.sort_by_key(|f| file_type_order(&f.file_type));
    out
}

fn extract_package(params: &[(String, String)]) -> Option<String> {
    for key in PACKAGE_KEYS {
        if let Some((_, v)) = params.iter().find(|(k, _)| k == key) {
            return Some(v.clone());
        }
    }
    for key in PACKAGE_KEYS {
        let lower = key.to_lowercase();
        if let Some((_, v)) = params
            .iter()
            .find(|(k, _)| k.to_lowercase().contains(&lower))
        {
            return Some(v.clone());
        }
    }
    None
}

/// 提取 `<script id="__NEXT_DATA__">…</script>` 内的 JSON
fn extract_next_data(html: &str) -> Option<&str> {
    let idx = html.find("id=\"__NEXT_DATA__\"")?;
    let rest = &html[idx..];
    let gt = rest.find('>')?;
    let after = &rest[gt + 1..];
    let start = after.find('{')?;
    let json_part = &after[start..];
    let end = json_part.find("</script>")?;
    Some(json_part[..end].trim())
}

fn looks_like_verification_page(html: &str) -> bool {
    VERIFY_TOKENS.iter().any(|t| html.contains(t))
}

/// 提取页面中的 `var 变量名 = "值";`（等号两侧可有空格，值可为数字）
fn extract_js_var(html: &str, name: &str) -> Option<String> {
    let pat = format!("var {}", name);
    let idx = html.find(&pat)?;
    let after = html[idx + pat.len()..].trim_start();
    let rest = after.strip_prefix('=')?.trim_start();
    let end = rest.find(';')?;
    let raw = rest[..end].trim().trim_matches('"').trim_matches('\'');
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

/// Cookie 名 = {_xvpfs}{_xvasu}，值 = base64(RC4(key, "{_xvpts}:{_xvasu}"))
fn build_verification_cookie(html: &str) -> Option<String> {
    let xvasu = extract_js_var(html, "_xvasu")?;
    let xvpts = extract_js_var(html, "_xvpts")?;
    let xvpfs = extract_js_var(html, "_xvpfs")?;
    if xvasu.is_empty() || xvpts.is_empty() || xvpfs.is_empty() {
        return None;
    }
    let payload = format!("{}:{}", xvpts, xvasu);
    let encrypted = rc4(VERIFY_KEY.as_bytes(), payload.as_bytes());
    Some(format!("{}{}={}", xvpfs, xvasu, STANDARD.encode(encrypted)))
}

/// RC4 加密（反爬校验 Cookie 用）
fn rc4(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut state: Vec<u8> = (0..=255u8).collect();
    let mut j: usize = 0;
    for i in 0..256 {
        j = (j + state[i] as usize + key[i % key.len()] as usize) % 256;
        state.swap(i, j);
    }
    let (mut i, mut j) = (0usize, 0usize);
    let mut out = Vec::with_capacity(data.len());
    for byte in data {
        i = (i + 1) % 256;
        j = (j + state[i] as usize) % 256;
        state.swap(i, j);
        let k = state[(state[i] as usize + state[j] as usize) % 256];
        out.push(byte ^ k);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rc4_matches_standard_vector() {
        // RFC 6229 向量：Key="Key", Plaintext="Plaintext" → BBF316E8D940AF0AD3
        let out = rc4(b"Key", b"Plaintext");
        let hex: String = out.iter().map(|b| format!("{:02X}", b)).collect();
        assert_eq!(hex, "BBF316E8D940AF0AD3");
    }

    #[test]
    fn rc4_uses_expected_verify_key() {
        // 与立创页面一致的构造：base64(RC4("tg09It3*9h", "123:abc"))
        let out = rc4(VERIFY_KEY.as_bytes(), b"123:abc");
        assert_eq!(out.len(), 7);
        assert_ne!(STANDARD.encode(&out), STANDARD.encode(b"123:abc"));
    }

    #[test]
    fn extract_js_var_reads_quoted_value() {
        let html = r#"<script>var _xvasu="abc123";var _xvpts="999";</script>"#;
        assert_eq!(extract_js_var(html, "_xvasu").as_deref(), Some("abc123"));
        assert_eq!(extract_js_var(html, "_xvpts").as_deref(), Some("999"));
        assert_eq!(extract_js_var(html, "_xvpfs"), None);
    }

    #[test]
    fn extract_js_var_tolerates_spaces_and_numbers() {
        // 立创验证页实际格式：等号两侧有空格、值为数字
        let html = "var _xvasu = 1104951776;\nvar _xvpfs = \"tws2_\";\nvar _xvpts = 1788172702.812;";
        assert_eq!(extract_js_var(html, "_xvasu").as_deref(), Some("1104951776"));
        assert_eq!(extract_js_var(html, "_xvpfs").as_deref(), Some("tws2_"));
        assert_eq!(extract_js_var(html, "_xvpts").as_deref(), Some("1788172702.812"));
    }

    #[test]
    fn extract_next_data_reads_json() {
        let html = r#"<html><script id="__NEXT_DATA__" type="application/json">{"a":1}</script></html>"#;
        assert_eq!(extract_next_data(html), Some(r#"{"a":1}"#));
        assert_eq!(extract_next_data("<html></html>"), None);
    }

    #[test]
    fn strip_html_tags_removes_highlight() {
        assert_eq!(strip_html_tags("贴片电阻 <em>10K</em>"), "贴片电阻 10K");
    }

    #[test]
    fn lcsc_code_validation() {
        assert!(is_lcsc_code("C17710"));
        assert!(!is_lcsc_code("10K"));
        assert!(!is_lcsc_code("C"));
        assert!(!is_lcsc_code("C12A"));
    }

    #[test]
    fn package_extracted_from_params() {
        let params = vec![
            ("阻值".to_string(), "10kΩ".to_string()),
            ("封装".to_string(), "0603".to_string()),
        ];
        assert_eq!(extract_package(&params).as_deref(), Some("0603"));
    }

    #[test]
    fn parse_files_extracts_all_types_and_absolutizes() {
        let product = serde_json::json!({
            "fileTypeVOList": [
                { "fileType": "certification_data_property", "detailVOList": [
                    { "fileName": "ROHS.pdf", "fileUrl": "/upload/public/pdf/source/2025/ROHS.pdf", "linkAddress": null }
                ]},
                { "fileType": "pdf_property", "detailVOList": [
                    { "fileName": "wj221811", "fileUrl": "/upload/public/pdf/source/2017/ds.pdf", "linkAddress": null }
                ]},
                { "fileType": "industry_information", "detailVOList": [
                    { "fileName": "变更.pdf.pdf.pdf", "fileUrl": "/upload/public/pdf/source/2025/chg.pdf", "linkAddress": null }
                ]}
            ]
        });
        let files = parse_files(&product);
        assert_eq!(files.len(), 3);
        // 数据手册排最前
        assert_eq!(files[0].file_type, "pdf_property");
        assert_eq!(files[0].url, "https://atta.szlcsc.com/upload/public/pdf/source/2017/ds.pdf");
        // 重复叠加的 .pdf 后缀只保留一次
        assert_eq!(files[1].name, "变更.pdf");
        assert_eq!(files[2].file_type, "certification_data_property");
    }

    #[test]
    fn parse_files_prefers_link_address() {
        let product = serde_json::json!({
            "fileTypeVOList": [
                { "fileType": "pdf_property", "detailVOList": [
                    { "fileName": "外链手册", "fileUrl": "/upload/x.pdf", "linkAddress": "https://vendor.example.com/ds.pdf" }
                ]}
            ]
        });
        let files = parse_files(&product);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].url, "https://vendor.example.com/ds.pdf");
    }

    #[test]
    fn parse_files_ignores_missing_entries() {
        let product = serde_json::json!({ "productCode": "C1" });
        assert!(parse_files(&product).is_empty());
    }
}
