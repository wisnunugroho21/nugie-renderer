vec4 fresnelSchlick(float cosTheta, vec4 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float D_GGX(float NoH, float roughness) {
    float alpha = roughness * roughness;
    float alpha2 = alpha * alpha;
    float NoH2 = NoH * NoH;
    float b = (NoH2 * (alpha2 - 1.0) + 1.0);

    return alpha2 / (PI * b * b);
}

float G1_GGX_Schlick(float NoV, float roughness) {
    //float r = roughness; // original
    float r = 0.5 + 0.5 * roughness; // Disney remapping
    float k = (r * r) / 2.0;
    float denom = NoV * (1.0 - k) + k;

    return max(NoV, 0.001) / denom;
}

float G_Smith(float NoV, float NoL, float roughness) {
    float g1_l = G1_GGX_Schlick(NoL, roughness);
    float g1_v = G1_GGX_Schlick(NoV, roughness);
    return g1_l * g1_v;
}

vec4 microfacetBRDF(vec4 lightDirection, vec4 viewDirection, vec4 fragNormal,
                    vec4 baseColor, float metallicness, float fresnelReflect, float roughness)
{
    vec4 H = normalize(viewDirection + lightDirection); // half vector

    // all required dot products
    float NoV = clamp(dot(fragNormal, viewDirection), 0.0, 1.0);
    float NoL = clamp(dot(fragNormal, lightDirection), 0.0, 1.0);
    float NoH = clamp(dot(fragNormal, H), 0.0, 1.0);
    float VoH = clamp(dot(viewDirection, H), 0.0, 1.0);

    // F0 for dielectics in range [0.0, 0.16]
    // default FO is (0.16 * 0.5^2) = 0.04
    vec4 f0 = vec4(0.16 * (fresnelReflect * fresnelReflect));
    // in case of metals, baseColor contains F0
    f0 = mix(f0, baseColor, metallicness);

    // specular microfacet (cook-torrance) BRDF
    vec4 F = fresnelSchlick(VoH, f0);
    float D = D_GGX(NoH, roughness);
    float G = G_Smith(NoV, NoL, roughness);
    vec4 spec = (F * D * G) / (4.0 * max(NoV, 0.001) * max(NoL, 0.001));

    // diffuse
    vec4 rhoD = baseColor;
    rhoD *= vec4(1.0) - F; // if not specular, use as diffuse (optional)
    rhoD *= (1.0 - metallicness); // no diffuse for metals
    vec4 diff = rhoD * RECIPROCAL_PI;

    return diff + spec;
}