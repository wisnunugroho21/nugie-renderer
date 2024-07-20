#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "texture.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/image/image.hpp"
#include "../../../vulkan/sampler/sampler.hpp"

#include <memory>

namespace NugieApp
{
    class HeightMapMultiTexture {
    public:
        HeightMapMultiTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints, uint32_t splitCount);

        ~HeightMapMultiTexture();

        NugieVulkan::Image *getImage(uint32_t imageIndex) const { return this->images[imageIndex]; }

        std::vector<NugieVulkan::Image*> getImages(uint32_t imageIndex) const { return this->images; }

        bool hasBeenMipmapped() const { return this->hasMipmapped; }

        VkDescriptorImageInfo
        getDescriptorInfo(uint32_t imageIndex, VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) const;

        std::vector<VkDescriptorImageInfo>
        getDescriptorInfos(VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) const;

        void generateMipmap(NugieVulkan::CommandBuffer *commandBuffer);

    protected:
        NugieVulkan::Device *device = nullptr;        
        NugieVulkan::Sampler *sampler = nullptr;

        std::vector<NugieVulkan::Buffer*> stagingBuffers;
        std::vector<NugieVulkan::Image*> images;

        bool hasMipmapped = false;

        virtual void createImage(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints, uint32_t splitCount);

        virtual void createSampler();
    };
} // namespace NugieApp
