// Includes
#include <iostream>
#include <cassert>
#include <vector>

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>

#include "src/camera/camera.hpp"
#include "src/device/device.hpp"
#include "src/buffer/master/master_buffer.hpp"
#include "src/buffer/child/child_buffer.hpp"

nugie::Camera* camera;
nugie::Device* device;

nugie::MasterBuffer* vertexBuffer;
nugie::MasterBuffer* uniformBuffer;

wgpu::Buffer indexBuffer;

wgpu::Texture objectTexture;
wgpu::TextureView objectTextureView;
wgpu::Sampler objectSampler;

wgpu::Texture depthTexture;
wgpu::TextureView depthTextureView;

wgpu::RenderPipeline renderPipeline;
wgpu::PipelineLayout renderPipelineLayout;

wgpu::BindGroupLayout sceneBindGroupLayout;
wgpu::BindGroupLayout objectBindGroupLayout;

wgpu::BindGroup sceneBindGroup;
wgpu::BindGroup objectBindGroup;

// settings
const unsigned int SCR_WIDTH = 800;
const unsigned int SCR_HEIGHT = 600;

// camera
float lastX = SCR_WIDTH / 2.0f;
float lastY = SCR_HEIGHT / 2.0f;
bool firstMouse = true;

// timing
float deltaTime = 0;

const char* shaderSource = R"(
    struct SceneUniform {
        cameraTransform: mat4x4f
    }

    struct ObjectUniform {
        modelTransform: mat4x4f
    }

    struct VertexInput {
        @location(0) position: vec3f,
        @location(1) uv: vec2f
    }

    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) uv: vec2f
    }

    @group(0) @binding(0) var<uniform> sceneUniform: SceneUniform;
    @group(1) @binding(0) var<uniform> objectUniform: ObjectUniform;
    @group(1) @binding(1) var objectTexture: texture_2d<f32>;
    @group(1) @binding(2) var objectSampler: sampler;
    
    @vertex
    fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        output.position = sceneUniform.cameraTransform * objectUniform.modelTransform * vec4f(input.position, 1.0);
        output.uv = input.uv;

        return output;
    }

    @fragment
    fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
        return textureSample(objectTexture, objectSampler, uv);
    }

    @fragment
    fn fragmentMain_(@location(0) uv: vec2f) -> @location(0) vec4f {
        var lightColor: vec3f = vec3f(1.0, 1.0, 1.0);
        var objectColor: vec3f = vec3f(1.0, 0.5, 0.31);
        var ambientStrength: f32 = 0.1;

        var ambient: vec3f = ambientStrength * lightColor;

        var result: vec3f = ambient * objectColor;
        return vec4f(result, 1.0);
    }
)";

void createVertexBuffer(nugie::Device* device, size_t vectorSize) {
    wgpu::BufferDescriptor bufferDesc;
    bufferDesc.label = "Vertex Buffer";
    bufferDesc.size = vectorSize * (sizeof(glm::vec4) + sizeof(glm::vec2));
    bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Vertex;
    bufferDesc.mappedAtCreation = false;

    vertexBuffer = device->createMasterBuffer(bufferDesc);
}

void createUniformBuffer(nugie::Device* device, size_t size) {
    wgpu::BufferDescriptor bufferDesc{};
    bufferDesc.label = "Uniform Buffer";
    bufferDesc.size = size;
    bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Uniform;
    bufferDesc.mappedAtCreation = false;

    uniformBuffer = device->createMasterBuffer(bufferDesc);
}

void createIndexBuffer(nugie::Device* device, size_t vectorSize) {
    wgpu::BufferDescriptor bufferDesc;
    bufferDesc.label = "Index Buffer";
    bufferDesc.size = vectorSize * sizeof(uint32_t);
    bufferDesc.usage = wgpu::BufferUsage::CopyDst | wgpu::BufferUsage::Index;
    bufferDesc.mappedAtCreation = false;

    indexBuffer = device->createBuffer(bufferDesc);
}

void createAndLoadSimpleTexture(nugie::Device* device) {
    int texWidth, texHeight, texChannels;
    stbi_uc* pixels = stbi_load("../asset/textures/wall.jpg", &texWidth, &texHeight, &texChannels, STBI_rgb_alpha);
    size_t imageSize = texWidth * texHeight * 4;

    if (!pixels) {
        throw std::runtime_error("failed to load texture image!");
    }

    wgpu::TextureDescriptor textureDesc{};
    textureDesc.nextInChain = nullptr;
    textureDesc.label = "Simple Texture";
    textureDesc.dimension = wgpu::TextureDimension::_2D;
    textureDesc.size = { static_cast<uint32_t>(texWidth), static_cast<uint32_t>(texHeight), 1 };
    textureDesc.mipLevelCount = 1;
    textureDesc.sampleCount = 1;
    textureDesc.format = wgpu::TextureFormat::RGBA8Unorm;
    textureDesc.usage = wgpu::TextureUsage::CopyDst | wgpu::TextureUsage::TextureBinding;

    objectTexture = device->createTexture(textureDesc);

    wgpu::TextureViewDescriptor textureViewDesc{};
    textureViewDesc.nextInChain = nullptr;
    textureViewDesc.aspect = wgpu::TextureAspect::All;
    textureViewDesc.dimension = wgpu::TextureViewDimension::_2D;
    textureViewDesc.arrayLayerCount = 1;
    textureViewDesc.baseArrayLayer = 0;
    textureViewDesc.mipLevelCount = 1;
    textureViewDesc.baseMipLevel = 0;
    textureViewDesc.format = objectTexture.getFormat();

    objectTextureView = objectTexture.createView(textureViewDesc);

    wgpu::ImageCopyTexture destination{};
    destination.texture = objectTexture;
    destination.aspect = wgpu::TextureAspect::All;
    destination.mipLevel = 0;
    destination.origin = { 0, 0, 0 };

    wgpu::TextureDataLayout source;
    source.offset = 0;
    source.bytesPerRow = 4 * textureDesc.size.width;
    source.rowsPerImage = textureDesc.size.height;

    device->getQueue().writeTexture(destination, pixels, imageSize, source, textureDesc.size);
}

void createDepthTexture(nugie::Device* device) {
    wgpu::TextureDescriptor textureDesc{};
    textureDesc.nextInChain = nullptr;
    textureDesc.label = "Depth Texture";
    textureDesc.dimension = wgpu::TextureDimension::_2D;
    textureDesc.size = { 800, 600, 1 };
    textureDesc.mipLevelCount = 1;
    textureDesc.sampleCount = 1;
    textureDesc.format = wgpu::TextureFormat::Depth16Unorm;
    textureDesc.usage = wgpu::TextureUsage::RenderAttachment;

    depthTexture = device->createTexture(textureDesc);

    wgpu::TextureViewDescriptor textureViewDesc{};
    textureViewDesc.nextInChain = nullptr;
    textureViewDesc.aspect = wgpu::TextureAspect::DepthOnly;
    textureViewDesc.dimension = wgpu::TextureViewDimension::_2D;
    textureViewDesc.arrayLayerCount = 1;
    textureViewDesc.baseArrayLayer = 0;
    textureViewDesc.mipLevelCount = 1;
    textureViewDesc.baseMipLevel = 0;
    textureViewDesc.format = textureDesc.format;

    depthTextureView = depthTexture.createView(textureViewDesc);
}

void createSampler(nugie::Device* device) {
    wgpu::SamplerDescriptor samplerDesc{};
    samplerDesc.label = "Simple Sampler";
    samplerDesc.nextInChain = nullptr;
    samplerDesc.addressModeU = wgpu::AddressMode::MirrorRepeat;
    samplerDesc.addressModeV = wgpu::AddressMode::MirrorRepeat;
    samplerDesc.addressModeW = wgpu::AddressMode::MirrorRepeat;
    samplerDesc.minFilter = wgpu::FilterMode::Linear;
    samplerDesc.magFilter = wgpu::FilterMode::Linear;
    samplerDesc.mipmapFilter = wgpu::MipmapFilterMode::Linear;
    samplerDesc.lodMinClamp = 0.0f;
    samplerDesc.lodMaxClamp = 1.0f;
    samplerDesc.compare = wgpu::CompareFunction::Undefined;
    samplerDesc.maxAnisotropy = 1u;

    objectSampler = device->createSampler(samplerDesc);
}

void createSceneBindGroupLayout(nugie::Device* device) {
    wgpu::BindGroupLayoutEntry bindGroupLayoutEntries[1];
    bindGroupLayoutEntries[0].nextInChain = nullptr;
    bindGroupLayoutEntries[0].binding = 0;
    bindGroupLayoutEntries[0].visibility = wgpu::ShaderStage::Vertex;
    bindGroupLayoutEntries[0].buffer.type = wgpu::BufferBindingType::Uniform;
    bindGroupLayoutEntries[0].buffer.hasDynamicOffset = false;
    bindGroupLayoutEntries[0].buffer.nextInChain = nullptr;

    wgpu::BindGroupLayoutDescriptor bindGroupLayoutDesc{};
    bindGroupLayoutDesc.label = "Scene Bind Group Layout";
    bindGroupLayoutDesc.nextInChain = nullptr;
    bindGroupLayoutDesc.entryCount = 1;
    bindGroupLayoutDesc.entries = bindGroupLayoutEntries;

    sceneBindGroupLayout = device->createBindGroupLayout(bindGroupLayoutDesc);
}

void createObjectBindGroupLayout(nugie::Device* device) {
    wgpu::BindGroupLayoutEntry bindGroupLayoutEntries[3];
    bindGroupLayoutEntries[0].nextInChain = nullptr;
    bindGroupLayoutEntries[0].binding = 0;
    bindGroupLayoutEntries[0].visibility = wgpu::ShaderStage::Vertex;
    bindGroupLayoutEntries[0].buffer.type = wgpu::BufferBindingType::Uniform;
    bindGroupLayoutEntries[0].buffer.hasDynamicOffset = false;
    bindGroupLayoutEntries[0].buffer.nextInChain = nullptr;

    bindGroupLayoutEntries[1].nextInChain = nullptr;
    bindGroupLayoutEntries[1].binding = 1;
    bindGroupLayoutEntries[1].visibility = wgpu::ShaderStage::Fragment;
    bindGroupLayoutEntries[1].texture.nextInChain = nullptr;
    bindGroupLayoutEntries[1].texture.sampleType = wgpu::TextureSampleType::Float;
    bindGroupLayoutEntries[1].texture.viewDimension = wgpu::TextureViewDimension::_2D;

    bindGroupLayoutEntries[2].nextInChain = nullptr;
    bindGroupLayoutEntries[2].binding = 2;
    bindGroupLayoutEntries[2].visibility = wgpu::ShaderStage::Fragment;
    bindGroupLayoutEntries[2].sampler.nextInChain = nullptr;
    bindGroupLayoutEntries[2].sampler.type = wgpu::SamplerBindingType::Filtering;

    wgpu::BindGroupLayoutDescriptor bindGroupLayoutDesc{};
    bindGroupLayoutDesc.label = "Object Bind Group Layout";
    bindGroupLayoutDesc.nextInChain = nullptr;
    bindGroupLayoutDesc.entryCount = 3;
    bindGroupLayoutDesc.entries = bindGroupLayoutEntries;

    objectBindGroupLayout = device->createBindGroupLayout(bindGroupLayoutDesc);
}

void createRenderPipelineLayout(nugie::Device* device) {
    WGPUBindGroupLayout bindGroupLayouts[2] {
        sceneBindGroupLayout,
        objectBindGroupLayout
    };

    wgpu::PipelineLayoutDescriptor pipelineLayoutDesc{};
    pipelineLayoutDesc.label = "Render Pipeline Layout";
    pipelineLayoutDesc.bindGroupLayoutCount = 2;
    pipelineLayoutDesc.bindGroupLayouts = bindGroupLayouts;

    renderPipelineLayout = device->createPipelineLayout(pipelineLayoutDesc);
}

void createPipeline(nugie::Device* device) {
    wgpu::ShaderModuleWGSLDescriptor shaderCodeDesc{};
    shaderCodeDesc.chain.next = nullptr;
    shaderCodeDesc.chain.sType = wgpu::SType::ShaderModuleWGSLDescriptor;
    shaderCodeDesc.code = shaderSource;    

    wgpu::ShaderModuleDescriptor shaderDesc{};
    shaderDesc.nextInChain = &shaderCodeDesc.chain;

    wgpu::ShaderModule shaderModule = device->createShaderModule(shaderDesc);

    wgpu::VertexAttribute positionAttrib{};
    positionAttrib.shaderLocation = 0;
    positionAttrib.format = wgpu::VertexFormat::Float32x3;
    positionAttrib.offset = 0;

    wgpu::VertexAttribute textCoordAttrib{};
    textCoordAttrib.shaderLocation = 1;
    textCoordAttrib.format = wgpu::VertexFormat::Float32x2;
    textCoordAttrib.offset = 0;

    wgpu::VertexBufferLayout vertexBufferLayouts[2];
    vertexBufferLayouts[0].attributeCount = 1;
    vertexBufferLayouts[0].attributes = &positionAttrib;
    vertexBufferLayouts[0].arrayStride = sizeof(glm::vec3);
    vertexBufferLayouts[0].stepMode = wgpu::VertexStepMode::Vertex;

    vertexBufferLayouts[1].attributeCount = 1;
    vertexBufferLayouts[1].attributes = &textCoordAttrib;
    vertexBufferLayouts[1].arrayStride = sizeof(glm::vec2);
    vertexBufferLayouts[1].stepMode = wgpu::VertexStepMode::Vertex;

    wgpu::BlendState blendState{};
    blendState.color.srcFactor = wgpu::BlendFactor::SrcAlpha;
    blendState.color.dstFactor = wgpu::BlendFactor::OneMinusSrcAlpha;
    blendState.color.operation = wgpu::BlendOperation::Add;

    blendState.alpha.srcFactor = wgpu::BlendFactor::One;
    blendState.alpha.dstFactor = wgpu::BlendFactor::Zero;
    blendState.alpha.operation = wgpu::BlendOperation::Add;

    wgpu::ColorTargetState colorTarget{};
    colorTarget.nextInChain = nullptr;
    colorTarget.format = device->getSurfaceFormat();
    colorTarget.blend = &blendState;
    colorTarget.writeMask = wgpu::ColorWriteMask::All;

    wgpu::VertexState vertexState{};
    vertexState.nextInChain = nullptr;
    vertexState.bufferCount = 2;
    vertexState.buffers = vertexBufferLayouts;
    vertexState.module = shaderModule;
    vertexState.entryPoint = "vertexMain";
    vertexState.constantCount = 0;
    vertexState.constants = nullptr;

    wgpu::PrimitiveState primitiveState{};
    primitiveState.nextInChain = nullptr;
    primitiveState.topology = wgpu::PrimitiveTopology::TriangleList;
    primitiveState.stripIndexFormat = wgpu::IndexFormat::Undefined;
    primitiveState.frontFace = wgpu::FrontFace::CCW;
    primitiveState.cullMode = wgpu::CullMode::None;

    wgpu::FragmentState fragmentState{};
    fragmentState.nextInChain = nullptr;
    fragmentState.module = shaderModule;
    fragmentState.entryPoint = "fragmentMain";
    fragmentState.constantCount = 0;
    fragmentState.constants = nullptr;
    fragmentState.targetCount = 1;
    fragmentState.targets = &colorTarget;

    wgpu::DepthStencilState depthStencilState{};
    depthStencilState.nextInChain = nullptr;
    depthStencilState.depthWriteEnabled = true;
    depthStencilState.depthCompare = wgpu::CompareFunction::Less;
    depthStencilState.format = wgpu::TextureFormat::Depth16Unorm;
    depthStencilState.stencilReadMask = 0;
    depthStencilState.stencilWriteMask = 0;

    wgpu::MultisampleState multiSampleState{};
    multiSampleState.nextInChain = nullptr;
    multiSampleState.count = 1;
    multiSampleState.mask = ~0u;
    multiSampleState.alphaToCoverageEnabled = false;

    wgpu::RenderPipelineDescriptor pipelineDesc{};
    pipelineDesc.label = "Render Pipeline";
    pipelineDesc.vertex = vertexState;
    pipelineDesc.primitive = primitiveState;
    pipelineDesc.fragment = &fragmentState;
    pipelineDesc.depthStencil = &depthStencilState;
    pipelineDesc.multisample = multiSampleState;
    pipelineDesc.layout = renderPipelineLayout;

    renderPipeline = device->createRenderPipeline(pipelineDesc);
    shaderModule.release();
}

void createSceneBindGroup(nugie::Device* device, nugie::BufferInfo cameraTransformBufferInfo) {
    wgpu::BindGroupEntry bindGroupEntries[1];

    bindGroupEntries[0].nextInChain = nullptr;
    bindGroupEntries[0].binding = 0;
    bindGroupEntries[0].buffer = cameraTransformBufferInfo.buffer;
    bindGroupEntries[0].offset = cameraTransformBufferInfo.offset;
    bindGroupEntries[0].size = cameraTransformBufferInfo.size;

    wgpu::BindGroupDescriptor bindGroupDesc{};
    bindGroupDesc.label = "Scene Uniform Bind Group";
    bindGroupDesc.nextInChain = nullptr;
    bindGroupDesc.entryCount = 1;
    bindGroupDesc.entries = bindGroupEntries;
    bindGroupDesc.layout = sceneBindGroupLayout;
    
    sceneBindGroup = device->createBindGroup(bindGroupDesc);
}

void createObjectBindGroup(nugie::Device* device, nugie::BufferInfo modelTransformBufferInfo) {
    wgpu::BindGroupEntry bindGroupEntries[3];

    bindGroupEntries[0].nextInChain = nullptr;
    bindGroupEntries[0].binding = 0;
    bindGroupEntries[0].buffer = modelTransformBufferInfo.buffer;
    bindGroupEntries[0].offset = modelTransformBufferInfo.offset;
    bindGroupEntries[0].size = modelTransformBufferInfo.size;

    bindGroupEntries[1].nextInChain = nullptr;
    bindGroupEntries[1].binding = 1;
    bindGroupEntries[1].textureView = objectTextureView;

    bindGroupEntries[2].nextInChain = nullptr;
    bindGroupEntries[2].binding = 2;
    bindGroupEntries[2].sampler = objectSampler;

    wgpu::BindGroupDescriptor bindGroupDesc{};
    bindGroupDesc.label = "Object Uniform Bind Group";
    bindGroupDesc.nextInChain = nullptr;
    bindGroupDesc.entryCount = 3;
    bindGroupDesc.entries = bindGroupEntries;
    bindGroupDesc.layout = objectBindGroupLayout;
    
    objectBindGroup = device->createBindGroup(bindGroupDesc);
}

// process all input: query GLFW whether relevant keys are pressed/released this frame and react accordingly
// ---------------------------------------------------------------------------------------------------------
void processInput(GLFWwindow *window)
{
    if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS)
        glfwSetWindowShouldClose(window, true);

    if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS)
        camera->processKeyboard(nugie::CameraMovement::FORWARD, deltaTime);
    if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS)
        camera->processKeyboard(nugie::CameraMovement::BACKWARD, deltaTime);
    if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS)
        camera->processKeyboard(nugie::CameraMovement::LEFT, deltaTime);
    if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS)
        camera->processKeyboard(nugie::CameraMovement::RIGHT, deltaTime);
}

// glfw: whenever the mouse moves, this callback is called
// -------------------------------------------------------
void mouseCallback(GLFWwindow* /* window */, double xposIn, double yposIn)
{
    float xpos = static_cast<float>(xposIn);
    float ypos = static_cast<float>(yposIn);

    if (firstMouse)
    {
        lastX = xpos;
        lastY = ypos;
        firstMouse = false;
    }

    float xoffset = xpos - lastX;
    float yoffset = lastY - ypos; // reversed since y-coordinates go from bottom to top

    lastX = xpos;
    lastY = ypos;

    camera->processMouseMovement(xoffset, yoffset);
}

// glfw: whenever the mouse scroll wheel scrolls, this callback is called
// ----------------------------------------------------------------------
void scrollCallback(GLFWwindow* /* window */, double /* xoffset */, double yoffset)
{
    camera->processMouseScroll(static_cast<float>(yoffset));
}

int main (int, char**) {
    std::vector<glm::vec3> vertices {
        glm::vec3{ -0.5f, -0.5f, -0.5f },  
        glm::vec3{ -0.5f, -0.5f, -0.5f },

        glm::vec3{  0.5f, -0.5f, -0.5f }, 
        glm::vec3{  0.5f, -0.5f, -0.5f },
        glm::vec3{  0.5f, -0.5f, -0.5f },

        glm::vec3{  0.5f,  0.5f, -0.5f },

        glm::vec3{ -0.5f,  0.5f, -0.5f },
        glm::vec3{ -0.5f,  0.5f, -0.5f },

        glm::vec3{ -0.5f, -0.5f,  0.5f },

        glm::vec3{  0.5f, -0.5f,  0.5f },
        glm::vec3{  0.5f, -0.5f,  0.5f },

        glm::vec3{  0.5f,  0.5f,  0.5f },
        glm::vec3{  0.5f,  0.5f,  0.5f },

        glm::vec3{ -0.5f,  0.5f,  0.5f },
        glm::vec3{ -0.5f,  0.5f,  0.5f },
        glm::vec3{ -0.5f,  0.5f,  0.5f }
    };

    std::vector<glm::vec2> textCoords {
        glm::vec2{ 0.0f, 0.0f },
        glm::vec2{ 0.0f, 1.0f },

        glm::vec2{ 1.0f, 0.0f },
        glm::vec2{ 0.0f, 1.0f },
        glm::vec2{ 1.0f, 1.0f },

        glm::vec2{ 1.0f, 1.0f },

        glm::vec2{ 1.0f, 1.0f },
        glm::vec2{ 0.0f, 1.0f },

        glm::vec2{ 0.0f, 0.0f },

        glm::vec2{ 1.0f, 0.0f },
        glm::vec2{ 0.0f, 0.0f },

        glm::vec2{ 1.0f, 1.0f },
        glm::vec2{ 1.0f, 0.0f },

        glm::vec2{ 0.0f, 1.0f },
        glm::vec2{ 1.0f, 0.0f },
        glm::vec2{ 0.0f, 0.0f }
    };

    std::vector<uint32_t> indices {
        0, 2, 5,
        5, 7, 0,

        8, 9, 11,
        11, 13, 8,

        14, 6, 1,
        1, 8, 14,

        12, 5, 3,
        3, 10, 12,

        1, 4, 9,
        9, 8, 1,

        7, 5, 12,
        12, 15, 7
    };

    camera = new nugie::Camera(glm::vec3(0.0f, 0.0f,  3.0f));
    device = new nugie::Device("Nugie Renderer", 800, 600);

    createVertexBuffer(device, vertices.size());
    createIndexBuffer(device, indices.size());
    createUniformBuffer(device, 512);

    nugie::ChildBuffer positionBuffer = vertexBuffer->createChildBuffer(vertices.size() * sizeof(glm::vec4));
    nugie::ChildBuffer textCoordBuffer = vertexBuffer->createChildBuffer(textCoords.size() * sizeof(glm::vec2));

    nugie::ChildBuffer cameraTransformBuffer = uniformBuffer->createChildBuffer(256);
    nugie::ChildBuffer modelTransformBuffer = uniformBuffer->createChildBuffer(256);

    createAndLoadSimpleTexture(device);
    createSampler(device);

    createDepthTexture(device);

    createSceneBindGroupLayout(device);
    createObjectBindGroupLayout(device);

    createRenderPipelineLayout(device);
    createPipeline(device);

    createSceneBindGroup(device, cameraTransformBuffer.getInfo());
    createObjectBindGroup(device, modelTransformBuffer.getInfo());
    
    positionBuffer.write(vertices.data());
    textCoordBuffer.write(textCoords.data());

    device->getQueue().writeBuffer(indexBuffer, 0, indices.data(), indexBuffer.getSize());

    nugie::BufferInfo positionBufferInfo = positionBuffer.getInfo();
    nugie::BufferInfo textCoordBufferInfo = textCoordBuffer.getInfo();

    // ================================================================

    glm::mat4 projection = glm::perspective(glm::radians(45.0f), 800.0f / 600.0f, 0.1f, 100.0f);
    float lastFrame = 0.0f; // Time of last frame

    glfwSetCursorPosCallback(device->getWindow(), mouseCallback);
    glfwSetScrollCallback(device->getWindow(), scrollCallback);

    // glm::vec3 lightPos{1.2f, 1.0f, 2.0f};

    while(device->isRunning()) {
        device->poolEvents();

        float currentFrame = static_cast<float>(glfwGetTime());
        deltaTime = currentFrame - lastFrame;
        lastFrame = currentFrame;

        processInput(device->getWindow());

        glm::mat4 view = camera->getViewMatrix();
        glm::mat4 cameraTrans = projection * view;

        cameraTransformBuffer.write(&cameraTrans);

        glm::mat4 modelTrans = glm::mat4{1.0f};
        modelTransformBuffer.write(&modelTrans);

        wgpu::CommandEncoderDescriptor commandDesc{};
        commandDesc.label = "Command Encoder";
        commandDesc.nextInChain = nullptr;

        wgpu::CommandEncoder commandEncoder = device->createCommandEncoder(commandDesc);
        wgpu::TextureView surfaceTextureView = device->getNextSurfaceTextureView();

        wgpu::RenderPassColorAttachment colorAttach{};
        colorAttach.nextInChain = nullptr;
        colorAttach.view = surfaceTextureView;
        colorAttach.loadOp = wgpu::LoadOp::Clear;
        colorAttach.storeOp = wgpu::StoreOp::Store;
        colorAttach.clearValue = wgpu::Color{ 0, 0, 0, 0 };
        colorAttach.resolveTarget = nullptr;

        wgpu::RenderPassDepthStencilAttachment depthAttach{};
        depthAttach.view = depthTextureView;
        depthAttach.depthLoadOp = wgpu::LoadOp::Clear;
        depthAttach.depthStoreOp = wgpu::StoreOp::Discard;
        depthAttach.depthClearValue = 1.0f;
        depthAttach.depthReadOnly = false;

        depthAttach.stencilLoadOp = wgpu::LoadOp::Undefined;
        depthAttach.stencilStoreOp = wgpu::StoreOp::Undefined;
        depthAttach.stencilClearValue = 0;
        depthAttach.stencilReadOnly = true;

        #ifndef WEBGPU_BACKEND_WGPU
            colorAttach.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
        #endif // NOT WEBGPU_BACKEND_WGPU

        wgpu::RenderPassDescriptor renderPassDesc{};
        renderPassDesc.nextInChain = nullptr;
        renderPassDesc.label = "Render Pass";
        renderPassDesc.colorAttachmentCount = 1;
        renderPassDesc.colorAttachments = &colorAttach;
        renderPassDesc.depthStencilAttachment = &depthAttach;
        renderPassDesc.timestampWrites = nullptr;
        renderPassDesc.occlusionQuerySet = nullptr;

        wgpu::RenderPassEncoder renderPassEncoder = commandEncoder.beginRenderPass(renderPassDesc);

        renderPassEncoder.setPipeline(renderPipeline);
        
        renderPassEncoder.setVertexBuffer(0, positionBufferInfo.buffer, positionBufferInfo.offset, positionBufferInfo.size);
        renderPassEncoder.setVertexBuffer(1, textCoordBufferInfo.buffer, textCoordBufferInfo.offset, textCoordBufferInfo.size);
        
        renderPassEncoder.setBindGroup(0, sceneBindGroup, 0, nullptr);
        renderPassEncoder.setBindGroup(1, objectBindGroup, 0, nullptr);

        renderPassEncoder.setIndexBuffer(indexBuffer, wgpu::IndexFormat::Uint32, 0, indexBuffer.getSize());
        renderPassEncoder.drawIndexed(indices.size(), 1, 0, 0, 0);

        renderPassEncoder.end();
        renderPassEncoder.release();

        wgpu::CommandBuffer commandBuffer = commandEncoder.finish();
        commandEncoder.release();

        device->getQueue().submit(1, &commandBuffer);

        device->getSurface().present();
        surfaceTextureView.release();
    }

    sceneBindGroup.release();
    objectBindGroup.release();

    sceneBindGroupLayout.release();
    objectBindGroupLayout.release();

    objectSampler.release();
    objectTexture.release();
    
    renderPipeline.release();
    renderPipelineLayout.release();

    indexBuffer.release();

    delete uniformBuffer;
    delete vertexBuffer;

    delete device;
    delete camera;

    return 0;
}
