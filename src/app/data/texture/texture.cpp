#include "texture.hpp"

#define STB_IMAGE_IMPLEMENTATION

#include <stb_image.h>

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

namespace NugieApp {
    Texture::Texture(NugieVulkan::Device *device) : device{device} {};

    Texture::Texture(NugieVulkan::Device *device, NugieVulkan::CommandBuffer *commandBuffer,
                     const char *textureFileName) : device{device} {
        this->createImage(commandBuffer, textureFileName);
        this->createSampler();
    }

    Texture::~Texture() {
        if (this->sampler != nullptr) delete this->sampler;
        if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
        if (this->image != nullptr) delete this->image;
    }

    void Texture::createImage(NugieVulkan::CommandBuffer *commandBuffer, const char *textureFileName) {
        int texWidth, texHeight, texChannels;
        stbi_uc *pixels = stbi_load(textureFileName, &texWidth, &texHeight, &texChannels, STBI_rgb_alpha);

        if (!pixels) {
            throw std::runtime_error("failed to load texture image!");
        }

        uint32_t mipLevels = static_cast<uint32_t>(std::floor(std::log2(std::max(texWidth, texHeight)))) + 1;

        unsigned long pixelSize = 4;
        uint32_t pixelCount = texWidth * texHeight;

        this->stagingBuffer = new NugieVulkan::Buffer(
                this->device,
                pixelSize,
                pixelCount,
                VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                VMA_MEMORY_USAGE_AUTO,
                VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
        );

        this->stagingBuffer->map();
        this->stagingBuffer->writeToBuffer(pixels);

        stbi_image_free(pixels);

        this->image = new NugieVulkan::Image(this->device, texWidth, texHeight, mipLevels, VK_SAMPLE_COUNT_1_BIT,
                                             VK_FORMAT_R8G8B8A8_SRGB,
                                             VK_IMAGE_TILING_OPTIMAL,
                                             VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
                                             VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                             VK_IMAGE_ASPECT_COLOR_BIT);

        this->image->transitionImageLayout(commandBuffer, 
                                           VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                                           VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
                                           0, VK_ACCESS_TRANSFER_WRITE_BIT);

        this->stagingBuffer->copyBufferToImage(commandBuffer, this->image);
    }

    void Texture::createSampler() {
        this->sampler = new NugieVulkan::Sampler(this->device, VK_FILTER_LINEAR,
                                                 VK_SAMPLER_ADDRESS_MODE_REPEAT,
                                                 VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                 VK_SAMPLER_MIPMAP_MODE_LINEAR, static_cast<float>(this->image->getMipLevels()));
    }

    VkDescriptorImageInfo Texture::getDescriptorInfo(VkImageLayout desiredImageLayout) const {
        return this->sampler->getDescriptorInfo(this->image, desiredImageLayout);
    }

    void Texture::generateMipmap(NugieVulkan::CommandBuffer *commandBuffer) {
        this->image->generateMipMap(commandBuffer);
        this->hasMipmapped = true;
    }
} // namespace NugieApp
