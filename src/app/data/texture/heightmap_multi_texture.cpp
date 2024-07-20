#include "heightmap_multi_texture.hpp"

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

namespace NugieApp {
    HeightMapMultiTexture::HeightMapMultiTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints, uint32_t splitCount) : device{device} {
        this->createImage(commandBuffer, heightPoints, splitCount);
        this->createSampler();
    }

    HeightMapMultiTexture::~HeightMapMultiTexture() {
        delete this->sampler;

        for (auto &&stagingBuffer : this->stagingBuffers) {
            delete stagingBuffer;            
        }

        for (auto &&image : this->images) {
            delete image;            
        }
    }

    void HeightMapMultiTexture::createImage(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints, uint32_t splitCount) {
        uint32_t sqrSize = sqrt(static_cast<uint32_t>(heightPoints.size()));
        uint32_t splitSize = sqrSize / splitCount;

        uint32_t mipLevels = static_cast<uint32_t>(std::floor(std::log2(std::max(sqrSize, sqrSize)))) + 1;
        std::vector<float> newHeightPoints;
        newHeightPoints.reserve(splitSize * splitSize);

        for (size_t ySplitIdx = 0; ySplitIdx < splitCount; ySplitIdx++) {
            for (size_t xSplitIdx = 0; xSplitIdx < splitCount; xSplitIdx++) {
                this->stagingBuffers.emplace_back(
                    new NugieVulkan::Buffer(this->device,
                                            sizeof(float),
                                            splitSize * splitSize,
                                            VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                                            VMA_MEMORY_USAGE_AUTO,
                                            VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT)
                );

                this->images.emplace_back(
                    new NugieVulkan::Image(this->device, splitSize, splitSize, 1u, VK_SAMPLE_COUNT_1_BIT, 
                                           VK_FORMAT_R32_SFLOAT, VK_IMAGE_TILING_OPTIMAL, 
                                           VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
                                           VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT)
                );

                newHeightPoints.clear();
                
                for (uint32_t y = 0; y < splitSize; y++) {
                    for (size_t x = 0; x < splitSize; x++) {
                        uint32_t totalIdx = x 
                            + y * splitSize
                            + xSplitIdx * splitSize
                            + ySplitIdx * splitSize * sqrSize;

                        newHeightPoints.emplace_back(heightPoints[totalIdx]);
                    }
                }

                std::size_t latestIndexStagingBuffer = this->stagingBuffers.size() - 1u;

                this->stagingBuffers[latestIndexStagingBuffer]->map();
                this->stagingBuffers[latestIndexStagingBuffer]->writeToBuffer((void*) newHeightPoints.data());
                
                this->images[latestIndexStagingBuffer]->transitionImageLayout(commandBuffer, 
                                            VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
                                            VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
                                            0, VK_ACCESS_TRANSFER_WRITE_BIT);
        
                this->stagingBuffers[latestIndexStagingBuffer]->copyBufferToImage(commandBuffer, this->images[latestIndexStagingBuffer]);

                this->images[latestIndexStagingBuffer]->transitionImageLayout(commandBuffer, 
                                                VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, 
                                                VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
                                                VK_ACCESS_TRANSFER_WRITE_BIT, 0);
            }
        }
    }

    void HeightMapMultiTexture::createSampler() {
        this->sampler = new NugieVulkan::Sampler(this->device, VK_FILTER_LINEAR,
                                                 VK_SAMPLER_ADDRESS_MODE_REPEAT,
                                                 VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                 VK_SAMPLER_MIPMAP_MODE_LINEAR, static_cast<float>(this->images[0]->getMipLevels()));
    }

    VkDescriptorImageInfo HeightMapMultiTexture::getDescriptorInfo(uint32_t imageIndex, VkImageLayout desiredImageLayout) const {
        return this->sampler->getDescriptorInfo(this->images[imageIndex], desiredImageLayout);
    }

    std::vector<VkDescriptorImageInfo> HeightMapMultiTexture::getDescriptorInfos(VkImageLayout desiredImageLayout) const {
        std::vector<VkDescriptorImageInfo> descSets;

        for (auto &&image : this->images) {
            descSets.emplace_back(this->sampler->getDescriptorInfo(image, desiredImageLayout));
        }

        return descSets;        
    }

    void HeightMapMultiTexture::generateMipmap(NugieVulkan::CommandBuffer *commandBuffer) {
        for (auto &&image : this->images) {
            image->generateMipMap(commandBuffer);
        }
        
        this->hasMipmapped = true;
    }
} // namespace NugieApp
