import { Injectable } from "@nestjs/common";
import { CreateBoardDto } from "./dto/create-board.dto";
import { UpdateBoardDto } from "./dto/update-board.dto";
import { Board } from "./entities/board.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { FindManyOptions, In, Like, Repository } from "typeorm";
import { FindAllArgDto } from "./dto/board.dto";
import { User } from "../user/entities/user.entity";
import { Queue } from "bull";
import { InjectQueue } from "@nestjs/bull";
import fs from "fs";
import { join } from "path";
import { parse } from "csv-parse/sync";

@Injectable()
export class BoardService {
    constructor(
        @InjectRepository(Board)
        private readonly boardRepository: Repository<Board>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectQueue("meeting") private readonly queue: Queue
    ) {}

    contentToHashtag(content: string) {
        const hashtag = [];

        content?.replace(/#([0-9a-zA-Zㄱ-ㅎㅏ-ㅣ가-힣_]*)/g, (tag) => {
            const originalTag = tag;
            if (tag != "#") {
                tag = tag?.replace(/#/g, "");
                hashtag.push(tag);
            }
            return originalTag;
        });

        return hashtag;
    }

    async create(createBoardDto: CreateBoardDto) {
        try {
            const board: Board = {
                ...new Board(),
                ...createBoardDto,
            };

            await this.boardRepository.save(board);

            return board;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async findAll(args?: FindAllArgDto): Promise<[Board[], number]> {
        try {
            if (!args) {
                args = new FindAllArgDto();
            }

            const { userID, skip, take, hashtag, hashtagEqual, keyword, name } =
                args;

            const findOptions: FindManyOptions<Board> = {
                order: {
                    createdAt: "DESC",
                },
                skip,
                take,
            };

            const userIdsContainName =
                name &&
                (
                    await this.userRepository.find({
                        where: {
                            name: Like(`%${name}%`),
                        },
                    })
                ).map((v) => v.id);

            if (name && userIdsContainName.length === 0) {
                console.log("이름을 가진 사람 없음");
                return [[], 0];
            }

            if (userID || hashtag || hashtagEqual || keyword || name) {
                findOptions.where = {};

                if (userID) findOptions.where["authorID"] = userID;
                if (userIdsContainName)
                    findOptions.where["authorID"] = In(userIdsContainName);
                if (keyword)
                    findOptions.where["content"] = Like(`%${keyword}%`);
                if (hashtag || hashtagEqual)
                    findOptions.where["hashtag"] = Like(
                        `%${hashtag ?? hashtagEqual}%`
                    );
            }

            const result = await this.boardRepository.findAndCount(findOptions);

            if (process.env.USE_COLOR) {
                result[0] = result[0].map((v) => {
                    v["primary_color"] = [];
                    v["secondary_color"] = [];
                    v["therapeutic_color"] = [];
                    for (const img in v.image) {
                        const filename = v.image[img];
                        const filenameCSV = `${filename.split(".")[0]}.csv`;
                        if (
                            fs.existsSync(
                                `${join(
                                    __dirname,
                                    "..",
                                    "..",
                                    "..",
                                    "..",
                                    "..",
                                    "public",
                                    filenameCSV
                                )}`
                            )
                        ) {
                            const csv = fs.readFileSync(
                                `${join(
                                    __dirname,
                                    "..",
                                    "..",
                                    "..",
                                    "..",
                                    "..",
                                    "public",
                                    filenameCSV
                                )}`
                            );
                            const data = parse(csv.toString("utf-8"));
                            // console.log(data)
                            v["primary_color"].push(data[1][0]);
                            v["secondary_color"].push(data[1][1]);
                            v["therapeutic_color"].push(data[1][2]);
                        } else {
                            v["primary_color"].push("LOADING...");
                            v["secondary_color"].push("LOADING...");
                            v["therapeutic_color"].push("LOADING...");
                        }
                    }
                    return v;
                });
            }

            return result;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    findOne(id: string) {
        return this.boardRepository.findOne(id);
    }

    remove(id: string) {
        try {
            return this.boardRepository.softDelete(id);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async sendMusic(notes: number[]) {
        try {
            await this.queue.add("music", {
                notes,
            });
            return true;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }
}
